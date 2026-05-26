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

// ---------------------------------------------------------------------------
// ArangoDB HTTP data source
// ---------------------------------------------------------------------------
//
// ArangoDB is a multi-model database — the same engine stores
// documents, graph edges, key-value pairs, and full-text indexes. Five
// traits set the wire shape apart from every prior backend in the
// Laika suite:
//
//   1. **Multi-model storage.** Documents, graph edges, and KV pairs
//      live as collections of different *types* in the same database.
//      The repository uses two `document` collections; graph edges
//      would be a future direction. **First multi-model backend in
//      the suite.**
//
//   2. **AQL — Arango Query Language.** `FOR doc IN collection FILTER
//      doc.x == @y RETURN doc`. Structurally distinct from SQL
//      (`SELECT ... FROM ... WHERE ...`), Mango / EdgeQL (shape
//      literals), Cypher (pattern matching), SurQL (statement-
//      delimited), Flux (functional pipeline). The closest analog is
//      list comprehension.
//
//   3. **Database in the URL path** — `/_db/{database}/_api/cursor`.
//      First backend with this convention. Other databases that
//      support multiple databases (Postgres, Mongo, etc.) usually
//      put the database in the auth context or a separate header.
//
//   4. **`_key / _id / _rev / _oldRev`** metadata field convention —
//      leading underscore for reserved fields. `_key` is the user-
//      facing primary key; `_id` is the fully-qualified
//      `<collection>/<key>` reference; `_rev` is the optimistic-
//      concurrency token. First backend with this naming pattern.
//
//   5. **Cursor-based query responses** — every AQL response is
//      `{result: [...], hasMore: false, cached: false, extra: {...},
//      error: false, code: 200}`. When `hasMore` is `true`, fetch
//      the next batch via `POST /_api/cursor/{id}`. **First backend
//      with explicit cursor-paginated envelope** (not just a
//      `nextCursor` field — a full envelope shape).

const DEFAULT_API_URL = 'http://localhost:8529';
const DEFAULT_DATABASE = '_system';

export interface ArangoAuth {
  /** HTTP Basic — typical for self-hosted clusters. */
  readonly basic?: { username: string, password: string };
  /** Bearer JWT — for ArangoDB Cloud / SSO. Note: lowercase 'bearer' is also accepted. */
  readonly bearer?: string;
  /** Async hook — overrides static auth fields. */
  readonly headerProvider?: () => Record<string, string> | Promise<Record<string, string>>;
}

export interface ArangoDataSourceOptions {
  readonly auth?: ArangoAuth;
  /** Base URL — default `http://localhost:8529`. */
  readonly url?: string;
  /** Database name — appears in the URL path. Default `_system`. */
  readonly database?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Every AQL response wraps results in this cursor envelope. */
export interface ArangoCursorResponse<T = unknown> {
  readonly result: T[];
  readonly hasMore: boolean;
  readonly id?: string;
  readonly cached?: boolean;
  readonly extra?: { stats?: Record<string, number> };
  readonly error: boolean;
  readonly code: number;
}

/** Common metadata fields on every Arango document. */
export interface ArangoDocMeta {
  readonly _key: string;
  readonly _id: string;
  readonly _rev: string;
}

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  let errorNum = 0;
  try {
    const parsed = JSON.parse(body) as { errorMessage?: string, errorNum?: number };
    if (parsed.errorMessage) detail = `: ${parsed.errorMessage}`;
    if (parsed.errorNum) errorNum = parsed.errorNum;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`ArangoDB authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`ArangoDB access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`ArangoDB not found: ${context}`));
    case 409:
      return Result.fail(
        new EntryAlreadyExistsError(`ArangoDB conflict (errorNum=${errorNum}) for ${context}${detail}`),
      );
    case 429:
      return Result.fail(new TooManyRequestsError(`ArangoDB rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`ArangoDB returned HTTP ${status} for ${context}`));
      }
      // Arango's ERROR_ARANGO_UNIQUE_CONSTRAINT_VIOLATED is 1210.
      if (errorNum === 1210) {
        return Result.fail(new EntryAlreadyExistsError(`ArangoDB unique constraint violated: ${context}${detail}`));
      }
      return Result.fail(new InternalError(`ArangoDB returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the ArangoDB HTTP API over `fetch`. Two primary methods:
 *
 *  - {@link aql} — fire one AQL query at `POST /_db/{db}/_api/cursor`.
 *    Returns the unwrapped `result` array; cursors with `hasMore=true`
 *    are handled internally (the data source pages through).
 *
 *  - {@link document} — direct document CRUD at
 *    `/_db/{db}/_api/document/{collection}[/{key}]`. Used for
 *    upserts where AQL would be overkill.
 *
 * Database name lives in the URL path on every request — that's the
 * defining wire-shape distinction.
 */
export class ArangoDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: ArangoAuth;
  private readonly apiUrl: string;
  readonly database: string;

  constructor(options: ArangoDataSourceOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via ArangoDataSourceOptions.fetch',
      );
    }
    this.auth = options.auth ?? {};
    this.apiUrl = (options.url ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.database = options.database ?? DEFAULT_DATABASE;
  }

  /**
   * Fire an AQL query. Bind variables travel under `bindVars` in the
   * JSON body. Returns the flattened `result` array — cursor
   * continuation is handled internally for queries with `hasMore: true`.
   */
  async aql<T = unknown>(
    query: string,
    bindVars: Record<string, unknown> = {},
  ): Promise<LaikaResult<T[]>> {
    const url = `${this.apiUrl}/_db/${encodeURIComponent(this.database)}/_api/cursor`;
    let response: Response;
    try {
      response = await this.request('POST', url, { query, bindVars, count: false });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('ArangoDB unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), query.slice(0, 60));
    let envelope = await response.json() as ArangoCursorResponse<T>;
    const collected: T[] = [...envelope.result];

    // Paginate through cursor continuations if the result set was large.
    while (envelope.hasMore && envelope.id !== undefined) {
      let cont: Response;
      try {
        cont = await this.request(
          'POST',
          `${this.apiUrl}/_db/${encodeURIComponent(this.database)}/_api/cursor/${encodeURIComponent(envelope.id)}`,
        );
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('ArangoDB unreachable', { cause }));
      }
      if (!cont.ok) return errorForResponse(cont.status, await safeText(cont), `cursor continuation ${envelope.id}`);
      envelope = await cont.json() as ArangoCursorResponse<T>;
      collected.push(...envelope.result);
    }
    return Result.succeed(collected);
  }

  /**
   * Direct document upsert via `POST /_api/document/{collection}` with
   * `?overwriteMode=update`. Useful for idempotent creates.
   */
  async upsertDocument<T extends { _key: string }>(
    collection: string,
    doc: T,
    options: { overwriteMode?: 'update' | 'replace' | 'conflict' | 'ignore' } = {},
  ): Promise<LaikaResult<T & ArangoDocMeta>> {
    const overwrite = options.overwriteMode ?? 'replace';
    const url = `${this.apiUrl}/_db/${encodeURIComponent(this.database)}/_api/document/${
      encodeURIComponent(collection)
    }?overwriteMode=${overwrite}&returnNew=true`;
    let response: Response;
    try {
      response = await this.request('POST', url, doc);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('ArangoDB unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `${collection}/${doc._key}`);
    const body = await response.json() as ArangoDocMeta & { new?: T & ArangoDocMeta };
    return Result.succeed(body.new ?? { ...doc, ...body } as T & ArangoDocMeta);
  }

  /** Get a document by `_key`. `null` on 404. */
  async getDocument<T = Record<string, unknown>>(
    collection: string,
    key: string,
  ): Promise<LaikaResult<(T & ArangoDocMeta) | null>> {
    const url = `${this.apiUrl}/_db/${encodeURIComponent(this.database)}/_api/document/${
      encodeURIComponent(collection)
    }/${encodeURIComponent(key)}`;
    let response: Response;
    try {
      response = await this.request('GET', url);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('ArangoDB unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `${collection}/${key}`);
    return Result.succeed(await response.json() as T & ArangoDocMeta);
  }

  // ───────────────────────── plumbing ─────────────────────────

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.auth.headerProvider) return await this.auth.headerProvider();
    const out: Record<string, string> = {};
    if (this.auth.basic) {
      out['Authorization'] = `Basic ${btoa(`${this.auth.basic.username}:${this.auth.basic.password}`)}`;
    } else if (this.auth.bearer) {
      // ArangoDB accepts both `Bearer` and `bearer` (case-insensitive per HTTP),
      // but their docs and JS driver use lowercase. We use the standard form.
      out['Authorization'] = `Bearer ${this.auth.bearer}`;
    }
    return out;
  }

  private async request(method: string, url: string, body?: unknown): Promise<Response> {
    const auth = await this.authHeaders();
    return this.fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...auth,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}
