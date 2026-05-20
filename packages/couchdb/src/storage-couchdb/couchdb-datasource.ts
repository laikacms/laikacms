import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  EntryAlreadyExistsError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from 'laikacms/core';

/**
 * Authentication shapes CouchDB / Cloudant accept. The vast majority of
 * deployments use HTTP Basic over TLS (admin party is increasingly rare);
 * Cloudant also accepts an IAM API key.
 */
export interface CouchDbAuth {
  /** HTTP Basic `username` / `password`. */
  readonly basic?: { username: string; password: string };
  /** Cookie produced by `POST /_session`. Refresh externally; this layer does not. */
  readonly cookie?: string;
  /** Generic `Authorization` header — useful for Cloudant IAM (`Bearer <token>`). */
  readonly authorizationHeader?: string;
  /** Async hook — overrides every above field when present. */
  readonly headerProvider?: () => Record<string, string> | Promise<Record<string, string>>;
}

export interface CouchDbDataSourceOptions {
  readonly auth: CouchDbAuth;
  /** Base URL with the database name, e.g. `https://example.com/cms`. */
  readonly url: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Subset of the CouchDB document shape we read. */
export interface CouchDbDoc {
  readonly _id: string;
  readonly _rev: string;
  readonly _deleted?: boolean;
}

/** Storage row shape — what we *write* into CouchDB. */
export interface StorageDoc extends CouchDbDoc {
  readonly type: 'file' | 'folder';
  readonly parent: string;
  readonly name: string;
  readonly extension?: string;
  readonly content?: string;
}

/** One entry in a `POST /_bulk_docs` response — per-doc success or conflict. */
export interface BulkDocsResultEntry {
  readonly id: string;
  readonly rev?: string;
  readonly ok?: boolean;
  readonly error?: string;
  readonly reason?: string;
}

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  let reason = '';
  try {
    const parsed = JSON.parse(body) as { error?: string; reason?: string };
    if (parsed.reason) { reason = parsed.reason; detail = `: ${parsed.error ?? ''} ${parsed.reason}`.trim(); }
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`CouchDB authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`CouchDB access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`CouchDB resource not found: ${context}`));
    case 409:
      // 409 means the doc already exists *and* the revision the caller passed
      // doesn't match (or none was passed for an existing id). It's both an
      // already-exists and a stale-rev signal — we surface as already-exists,
      // which is what the create paths care about. Update paths must check
      // for 409 themselves before this default fires.
      return Result.fail(
        new EntryAlreadyExistsError(`CouchDB document conflict for ${context}${reason ? `: ${reason}` : ''}`),
      );
    case 429:
      return Result.fail(new TooManyRequestsError(`CouchDB rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`CouchDB service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`CouchDB returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`CouchDB returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [Apache CouchDB](https://docs.couchdb.org/) HTTP API over `fetch`.
 *
 * Five endpoints carry the work:
 *
 * - `HEAD /db/{id}` — existence probe; the document's `_rev` is returned as
 *   the `ETag` header (with quotes).
 * - `GET /db/{id}` — full document fetch.
 * - `PUT /db/{id}` (body must include `_rev` on updates) — write one document.
 *   On stale-rev or already-exists, CouchDB returns **409 Conflict** — first
 *   true OCC mechanic in the Laika suite.
 * - `POST /db/_find` body `{selector: {...}}` — Mango query, the JSON-based
 *   query DSL CouchDB ships since 2.0. Used for child listings and
 *   extension-free key resolution.
 * - `POST /db/_bulk_docs` body `{docs: [...]}` — atomic multi-document
 *   write/delete. Returns one result entry per submitted doc; conflicts
 *   are reported per-doc rather than failing the whole batch.
 *
 * `removeAtoms(N)` ships as exactly **two** round-trips: one `POST /_find`
 * to resolve every key's `_rev`, then one `POST /_bulk_docs` with all
 * `_deleted: true` markers — irrespective of N.
 */
export class CouchDbDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: CouchDbAuth;
  private readonly baseUrl: string;

  constructor(options: CouchDbDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via CouchDbDataSourceOptions.fetch',
      );
    }
    if (
      !options.auth.basic
      && !options.auth.cookie
      && !options.auth.authorizationHeader
      && !options.auth.headerProvider
    ) {
      throw new InternalError(
        'CouchDbDataSource requires at least one of `auth.basic`, `auth.cookie`, `auth.authorizationHeader`, or `auth.headerProvider`',
      );
    }
    this.auth = options.auth;
    this.baseUrl = options.url.replace(/\/+$/, '');
  }

  // ───────────────────────── public ops ─────────────────────────

  /** `HEAD /db/{id}` → revision or `null` on 404. */
  async head(id: string): Promise<LaikaResult<string | null>> {
    let response: Response;
    try {
      response = await this.request('HEAD', this.docUrl(id));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('CouchDB unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, '', id);
    const etag = response.headers.get('etag');
    if (!etag) return Result.succeed(null);
    return Result.succeed(etag.replace(/^"|"$/g, ''));
  }

  /** `GET /db/{id}` → the document. */
  async get<T extends CouchDbDoc>(id: string): Promise<LaikaResult<T | null>> {
    let response: Response;
    try {
      response = await this.request('GET', this.docUrl(id));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('CouchDB unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), id);
    const doc = await response.json() as T;
    return Result.succeed(doc);
  }

  /** `PUT /db/{id}` — body must include `_rev` for updates. */
  async put(doc: StorageDoc): Promise<LaikaResult<{ id: string; rev: string }>> {
    let response: Response;
    try {
      response = await this.request('PUT', this.docUrl(doc._id), {
        body: JSON.stringify(doc),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('CouchDB unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), doc._id);
    const body = await response.json() as { id: string; rev: string };
    return Result.succeed({ id: body.id, rev: body.rev });
  }

  /**
   * `POST /db/_find` — Mango query. The selector and any sort / limit
   * fields are passed through verbatim. CouchDB supports a rich subset of
   * MongoDB-style operators (`$eq`, `$gt`, `$regex`, `$and`, `$or`, etc.);
   * the repository only uses the simple equality forms.
   */
  async find<T extends CouchDbDoc>(
    query: { selector: Record<string, unknown>; limit?: number; fields?: string[]; sort?: Array<Record<string, 'asc' | 'desc'>> },
  ): Promise<LaikaResult<T[]>> {
    let response: Response;
    try {
      response = await this.request('POST', `${this.baseUrl}/_find`, {
        body: JSON.stringify(query),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('CouchDB unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), '_find');
    const body = await response.json() as { docs: T[] };
    return Result.succeed(body.docs);
  }

  /**
   * `POST /db/_bulk_docs` — atomic multi-document write. Pass `_deleted: true`
   * on a doc (with its current `_rev`) to delete it.
   *
   * **Unique trait:** the response is per-doc — one entry can succeed while
   * another reports `error: 'conflict'`. Callers (i.e. `removeAtoms`) must
   * inspect the result array, not just the HTTP status.
   */
  async bulkDocs(
    docs: Array<Partial<StorageDoc> & { _id: string; _rev?: string; _deleted?: boolean }>,
  ): Promise<LaikaResult<BulkDocsResultEntry[]>> {
    let response: Response;
    try {
      response = await this.request('POST', `${this.baseUrl}/_bulk_docs`, {
        body: JSON.stringify({ docs }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('CouchDB unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), '_bulk_docs');
    const body = await response.json() as BulkDocsResultEntry[];
    return Result.succeed(body);
  }

  // ───────────────────────── plumbing ─────────────────────────

  private docUrl(id: string): string {
    // CouchDB requires URL-encoded ids but reserves `/` and `+` as document
    // path separators in a way that breaks naive encoding — `_design/` for
    // design docs, e.g. The repository's ids never contain those, but we
    // still encode each segment defensively.
    return `${this.baseUrl}/${id.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.auth.headerProvider) return await this.auth.headerProvider();
    const out: Record<string, string> = {};
    if (this.auth.basic) {
      const { username, password } = this.auth.basic;
      // Use a manual base64 — `btoa` is available in all target runtimes but
      // chokes on non-ASCII; usernames in CouchDB are ASCII in practice.
      const encoded = btoa(`${username}:${password}`);
      out['Authorization'] = `Basic ${encoded}`;
    }
    if (this.auth.cookie) out['Cookie'] = this.auth.cookie;
    if (this.auth.authorizationHeader) out['Authorization'] = this.auth.authorizationHeader;
    return out;
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: BodyInit; headers?: Record<string, string> },
  ): Promise<Response> {
    const auth = await this.authHeaders();
    return this.fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...auth,
        ...(init?.headers ?? {}),
      },
      body: init?.body,
    });
  }
}
