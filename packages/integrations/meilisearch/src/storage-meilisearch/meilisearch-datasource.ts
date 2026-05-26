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
// MeiliSearch HTTP data source
// ---------------------------------------------------------------------------
//
// MeiliSearch is a search engine — but its wire shape is structurally
// distinct from Algolia (iter 11) in five ways:
//
//   1. **Async-by-default mutations via the Tasks API.** Every
//      `PUT`/`DELETE`/`POST` that mutates state returns immediately
//      with `{taskUid, status: 'enqueued'}`. To know when the mutation
//      has actually applied, you `GET /tasks/{uid}` and poll until
//      `status === 'succeeded'` (or `'failed'`). The data source
//      automatically awaits every mutation by polling.
//
//   2. **`POST /indexes/{name}/documents/delete-batch`** — bulk delete
//      takes an array of primary-key strings in the body, returns ONE
//      task uid. **The 16th structurally distinct atomic-multi-write
//      mechanism in the Laika suite**: async-bulk-operation completed
//      via task polling. The whole batch commits atomically once the
//      task succeeds.
//
//   3. **SQL-like filter syntax** — `parent = "notes" AND type = "file"`.
//      Distinct from Algolia's Lucene-style `parent:"notes" AND
//      type:"file"`.
//
//   4. **Documents have a `primaryKey` declared at index creation
//      time**. Different from Algolia's automatic `objectID`. The
//      repository configures `id` as the primary key.
//
//   5. **Search via POST body** — `POST /indexes/{name}/search` with
//      `{filter, q, limit}` in the JSON body. Algolia puts these in
//      URL query parameters.

const DEFAULT_API_URL = 'http://localhost:7700';

export interface MeiliAuth {
  /** Master key or API key — `Authorization: Bearer …`. */
  readonly apiKey: string;
}

export interface MeiliDataSourceOptions {
  readonly auth: MeiliAuth;
  /** Base URL — default `http://localhost:7700`. */
  readonly url?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /** Maximum time to wait for a task to finish, in ms. Default 30s. */
  readonly taskTimeoutMs?: number;
  /** Sleep between task polls, in ms. Default 50ms. */
  readonly taskPollIntervalMs?: number;
}

/** Subset of the MeiliSearch task shape we read. */
export interface MeiliTask {
  readonly uid: number;
  readonly status: 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  readonly type: string;
  readonly enqueuedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly error?: { code?: string, message?: string, type?: string };
}

/** Response envelope from every mutating endpoint. */
export interface EnqueuedTask {
  readonly taskUid: number;
  readonly indexUid: string;
  readonly status: 'enqueued';
  readonly type: string;
  readonly enqueuedAt: string;
}

/** Document shape we store/search. */
export interface MeiliDocument {
  readonly id: string;
  readonly type: 'file' | 'folder';
  readonly parent: string;
  readonly name: string;
  readonly extension?: string;
  readonly content?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
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
  let code = '';
  try {
    const parsed = JSON.parse(body) as { code?: string, message?: string };
    code = parsed.code ?? '';
    if (parsed.message) detail = `: ${parsed.message}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`MeiliSearch authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`MeiliSearch access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`MeiliSearch resource not found: ${context}`));
    case 409:
      return Result.fail(new EntryAlreadyExistsError(`MeiliSearch conflict (${code}) for ${context}${detail}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`MeiliSearch rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`MeiliSearch returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`MeiliSearch returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the MeiliSearch HTTP API over `fetch`, with automatic Tasks API
 * polling for every mutation. Most callers don't need to think about the
 * async nature — `mutateAndAwait` blocks until the task succeeds and
 * surfaces task failures as typed errors.
 */
export class MeiliDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: MeiliAuth;
  private readonly apiUrl: string;
  private readonly taskTimeoutMs: number;
  private readonly taskPollIntervalMs: number;

  constructor(options: MeiliDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via MeiliDataSourceOptions.fetch',
      );
    }
    if (!options.auth?.apiKey) throw new InternalError('MeiliDataSource requires `auth.apiKey`');
    this.auth = options.auth;
    this.apiUrl = (options.url ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.taskTimeoutMs = options.taskTimeoutMs ?? 30_000;
    this.taskPollIntervalMs = options.taskPollIntervalMs ?? 50;
  }

  // ───────────────────────── public API ─────────────────────────

  /** Ensure an index exists with the given primary key. Idempotent. */
  async ensureIndex(indexUid: string, primaryKey: string): Promise<LaikaResult<void>> {
    // Check via GET; create on 404.
    const getResp = await this.request('GET', `/indexes/${encodeURIComponent(indexUid)}`);
    if (Result.isFailure(getResp)) return Result.fail(getResp.failure);
    if (getResp.success.status === 200) return Result.succeed(undefined);
    if (getResp.success.status !== 404) {
      return errorForResponse(getResp.success.status, await safeText(getResp.success), indexUid);
    }
    // Create it.
    return this.mutateAndAwait('POST', '/indexes', { uid: indexUid, primaryKey });
  }

  /** Fetch one document by primary-key value. `null` on 404. */
  async getDocument(
    indexUid: string,
    id: string,
  ): Promise<LaikaResult<MeiliDocument | null>> {
    const resp = await this.request(
      'GET',
      `/indexes/${encodeURIComponent(indexUid)}/documents/${encodeURIComponent(id)}`,
    );
    if (Result.isFailure(resp)) return Result.fail(resp.failure);
    if (resp.success.status === 404) return Result.succeed(null);
    if (!resp.success.ok) return errorForResponse(resp.success.status, await safeText(resp.success), id);
    return Result.succeed(await resp.success.json() as MeiliDocument);
  }

  /** Search documents — filter is the SQL-like DSL. Synchronous read endpoint. */
  async search(
    indexUid: string,
    options: { filter?: string, q?: string, limit?: number },
  ): Promise<LaikaResult<{ hits: MeiliDocument[], estimatedTotalHits: number }>> {
    const body: Record<string, unknown> = {};
    if (options.filter) body['filter'] = options.filter;
    if (options.q !== undefined) body['q'] = options.q;
    if (options.limit !== undefined) body['limit'] = options.limit;

    const resp = await this.request('POST', `/indexes/${encodeURIComponent(indexUid)}/search`, body);
    if (Result.isFailure(resp)) return Result.fail(resp.failure);
    if (!resp.success.ok) {
      return errorForResponse(resp.success.status, await safeText(resp.success), `search ${indexUid}`);
    }
    const parsed = await resp.success.json() as {
      hits: MeiliDocument[],
      estimatedTotalHits: number,
    };
    return Result.succeed(parsed);
  }

  /**
   * Add or replace documents — `PUT /indexes/{uid}/documents` with the
   * array as body. Returns after the resulting task succeeds.
   *
   * MeiliSearch upserts by primary key — no separate "create" vs "update"
   * at this level. The repository handles uniqueness checks above.
   */
  async upsertDocuments(
    indexUid: string,
    documents: ReadonlyArray<MeiliDocument>,
  ): Promise<LaikaResult<void>> {
    if (documents.length === 0) return Result.succeed(undefined);
    return this.mutateAndAwait(
      'PUT',
      `/indexes/${encodeURIComponent(indexUid)}/documents`,
      documents,
    );
  }

  /**
   * Bulk-delete by primary-key array. **The load-bearing distinctive
   * wire shape**: N IDs in one body → one task uid → one poll cycle.
   * The whole batch commits atomically once the task succeeds.
   */
  async deleteDocumentsBatch(
    indexUid: string,
    ids: ReadonlyArray<string>,
  ): Promise<LaikaResult<void>> {
    if (ids.length === 0) return Result.succeed(undefined);
    return this.mutateAndAwait(
      'POST',
      `/indexes/${encodeURIComponent(indexUid)}/documents/delete-batch`,
      ids,
    );
  }

  /** Configure which fields are filterable. Required for filter queries. */
  async updateFilterableAttributes(
    indexUid: string,
    attributes: ReadonlyArray<string>,
  ): Promise<LaikaResult<void>> {
    return this.mutateAndAwait(
      'PUT',
      `/indexes/${encodeURIComponent(indexUid)}/settings/filterable-attributes`,
      attributes,
    );
  }

  /** Get task status. Returns the task or null on 404. */
  async getTask(uid: number): Promise<LaikaResult<MeiliTask | null>> {
    const resp = await this.request('GET', `/tasks/${uid}`);
    if (Result.isFailure(resp)) return Result.fail(resp.failure);
    if (resp.success.status === 404) return Result.succeed(null);
    if (!resp.success.ok) return errorForResponse(resp.success.status, await safeText(resp.success), `task ${uid}`);
    return Result.succeed(await resp.success.json() as MeiliTask);
  }

  // ───────────────────────── plumbing ─────────────────────────

  /**
   * Run a mutation and block until the resulting task succeeds.
   * THIS is the load-bearing helper — every write path goes through
   * here, and the async-task-polling complexity stays out of the
   * repository layer.
   */
  private async mutateAndAwait(
    method: string,
    path: string,
    body: unknown,
  ): Promise<LaikaResult<void>> {
    const resp = await this.request(method, path, body);
    if (Result.isFailure(resp)) return Result.fail(resp.failure);
    if (!resp.success.ok) {
      return errorForResponse(resp.success.status, await safeText(resp.success), `${method} ${path}`);
    }
    const enqueued = await resp.success.json() as EnqueuedTask;
    return this.awaitTask(enqueued.taskUid);
  }

  /** Poll `/tasks/{uid}` until terminal status. */
  private async awaitTask(uid: number): Promise<LaikaResult<void>> {
    const start = Date.now();
    while (Date.now() - start < this.taskTimeoutMs) {
      const result = await this.getTask(uid);
      if (Result.isFailure(result)) return Result.fail(result.failure);
      const task = result.success;
      if (task === null) {
        return Result.fail(new NotFoundError(`MeiliSearch task ${uid} not found`));
      }
      if (task.status === 'succeeded') return Result.succeed(undefined);
      if (task.status === 'failed') {
        const msg = task.error?.message ?? 'unknown error';
        if (/index_already_exists|already_exists/i.test(task.error?.code ?? '')) {
          return Result.fail(new EntryAlreadyExistsError(`MeiliSearch task failed: ${msg}`));
        }
        return Result.fail(new InternalError(`MeiliSearch task ${uid} failed: ${msg}`));
      }
      if (task.status === 'canceled') {
        return Result.fail(new InternalError(`MeiliSearch task ${uid} was canceled`));
      }
      // status: 'enqueued' or 'processing' — keep waiting.
      await new Promise(r => setTimeout(r, this.taskPollIntervalMs));
    }
    return Result.fail(new ServiceUnavailableError(`MeiliSearch task ${uid} timed out`));
  }

  /** Low-level request — caller checks `.success.ok`. */
  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<LaikaResult<Response>> {
    const url = `${this.apiUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.auth.apiKey}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('MeiliSearch unreachable', { cause }));
    }
    return Result.succeed(response);
  }
}

// ---------------------------------------------------------------------------
// Filter DSL helpers (the SQL-like style MeiliSearch expects)
// ---------------------------------------------------------------------------

/** Escape a MeiliSearch filter string value — `"` becomes `\"`. */
export const escapeFilterString = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** `field = "value"` — MeiliSearch's equality predicate. */
export const eqFilter = (field: string, value: string): string => `${field} = "${escapeFilterString(value)}"`;

/** Combine filters with AND. */
export const andFilter = (...filters: string[]): string => filters.join(' AND ');
