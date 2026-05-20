import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from 'laikacms/core';

// ---------------------------------------------------------------------------
// etcd v3 JSON gateway client
// ---------------------------------------------------------------------------
//
// etcd's HTTP API is a JSON gateway sitting in front of the v3 gRPC server.
// Two quirks set it apart from every other backend in the suite:
//
//   1. **All keys and values are base64-encoded** in the JSON wire format.
//      A `put`'s body is `{"key": "<b64>", "value": "<b64>"}` — even ASCII
//      keys. This isn't documented loudly; the gateway just rejects raw
//      strings with an opaque error. The data source wraps every key/value
//      crossing the boundary with `b64encode` / `b64decode`.
//
//   2. **Prefix scans use a `[key, range_end)` pair**, not a separate
//      `prefix` parameter. To scan everything starting with `/notes/`,
//      the caller computes `range_end` by incrementing the last byte of
//      `key` (`/` → `0`); etcd then returns every key in
//      `[key, range_end)`. This is *the* etcd idiom — exposed by the
//      `prefixRange()` helper.
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = 'http://localhost:2379';

export interface EtcdAuth {
  /** Bearer token from `POST /v3/auth/authenticate`. */
  readonly token?: string;
  /** Async hook — overrides `token` when present. Token expiration handling
   *  lives outside this layer. */
  readonly tokenProvider?: () => string | Promise<string>;
  /** Extra headers merged onto every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface EtcdDataSourceOptions {
  readonly auth?: EtcdAuth;
  /** Base URL — `http(s)://host:port`. Default `http://localhost:2379`. */
  readonly url?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** One key/value pair as returned by `POST /v3/kv/range`. Strings are decoded. */
export interface EtcdKv {
  readonly key: string;
  readonly value: string;
  readonly createRevision: string;
  readonly modRevision: string;
  readonly version: string;
}

/**
 * A single op within a `Txn.success` / `Txn.failure` array. Mirrors the
 * etcd protobuf shape — exactly one of `requestPut` / `requestDeleteRange` /
 * `requestRange` must be present.
 */
export type TxnOp =
  | { readonly requestPut: { key: string; value: string } }
  | { readonly requestDeleteRange: { key: string; rangeEnd?: string } }
  | { readonly requestRange: { key: string; rangeEnd?: string; limit?: string } };

/** Compare clause for the Txn — etcd supports far more, the repo only uses these. */
export type TxnCompare =
  | { target: 'CREATE'; key: string; result: 'EQUAL' | 'NOT_EQUAL'; createRevision: string }
  | { target: 'MOD';    key: string; result: 'EQUAL' | 'NOT_EQUAL'; modRevision: string };

export interface EtcdTxnResult {
  readonly succeeded: boolean;
  readonly responses: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// base64 helpers
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

/** UTF-8 → base64. Works in Node, Bun, Workers, Deno, and the browser. */
const b64encode = (s: string): string => {
  // `btoa` requires Latin-1 input. For full UTF-8 fidelity (etcd allows
  // arbitrary bytes in keys, but we restrict ourselves to UTF-8 strings)
  // we re-encode through TextEncoder.
  const bytes = enc.encode(s);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** base64 → UTF-8 string. */
const b64decode = (s: string): string => {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return dec.decode(bytes);
};

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string; code?: number };
    const message = parsed.message ?? parsed.error;
    if (message) detail = `: ${message}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`etcd authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`etcd access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`etcd not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`etcd rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`etcd returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`etcd returned HTTP ${status} for ${context}${detail}`));
  }
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Compute the `range_end` half of an etcd prefix scan. Given a `prefix`,
 * returns the smallest key strictly greater than every key beginning with
 * `prefix` — i.e. `prefix` with the last byte incremented by 1. This is
 * THE etcd idiom for prefix scans (there's no separate `?prefix=` param).
 *
 * If `prefix` is empty, returns `"\0"` — etcd's marker for "scan to end".
 */
export const prefixRangeEnd = (prefix: string): string => {
  if (prefix.length === 0) return '\0';
  const last = prefix.charCodeAt(prefix.length - 1);
  return prefix.slice(0, -1) + String.fromCharCode(last + 1);
};

// ---------------------------------------------------------------------------
// Data source
// ---------------------------------------------------------------------------

/**
 * Talks the etcd v3 gRPC JSON gateway over `fetch`. Five endpoints carry
 * the work:
 *
 *  - `POST /v3/kv/range`        — get one key, or scan a `[key, range_end)`.
 *  - `POST /v3/kv/put`          — write one key. No If-Match in the request
 *                                 itself; OCC goes through `txn` instead.
 *  - `POST /v3/kv/deleterange`  — delete one key, or a range.
 *  - `POST /v3/kv/txn`          — atomic compare-and-set with multiple
 *                                 sub-requests. Used by `removeAtoms` to
 *                                 ship N deletes as one transaction.
 *  - `POST /v3/maintenance/status` — health probe (not used by the
 *                                    repository; exposed for app code).
 */
export class EtcdDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: EtcdAuth;
  private readonly apiUrl: string;

  constructor(options: EtcdDataSourceOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via EtcdDataSourceOptions.fetch',
      );
    }
    this.auth = options.auth ?? {};
    this.apiUrl = (options.url ?? DEFAULT_API_URL).replace(/\/+$/, '');
  }

  /** Get a single key. Returns `null` when absent. */
  async get(key: string): Promise<LaikaResult<EtcdKv | null>> {
    const body = await this.kvRange(key);
    if (Result.isFailure(body)) return Result.fail(body.failure);
    return Result.succeed(body.success[0] ?? null);
  }

  /** Range scan over `[prefix, prefixRangeEnd(prefix))`. Pages internally. */
  async listPrefix(prefix: string, options: { limit?: number } = {}): Promise<LaikaResult<EtcdKv[]>> {
    return this.kvRange(prefix, prefixRangeEnd(prefix), options.limit);
  }

  /** Write a single key. */
  async put(key: string, value: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('POST', '/v3/kv/put', {
        key: b64encode(key),
        value: b64encode(value),
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('etcd unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), key);
    return Result.succeed(undefined);
  }

  /** Delete a single key. Returns the count actually removed (0 or 1). */
  async delete(key: string): Promise<LaikaResult<number>> {
    let response: Response;
    try {
      response = await this.request('POST', '/v3/kv/deleterange', { key: b64encode(key) });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('etcd unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), key);
    const body = await response.json() as { deleted?: string };
    return Result.succeed(Number(body.deleted ?? 0));
  }

  /**
   * Atomic transaction. Used by the repository for two things:
   *
   *   - Create-if-not-exists semantics — compare `createRevision == 0`
   *     against a key, then put on success.
   *   - Atomic multi-key delete — pack N `requestDeleteRange` ops into
   *     `success`. Returns the count deleted in the response, summed
   *     across sub-responses.
   */
  async txn(input: {
    compare?: readonly TxnCompare[];
    success?: readonly TxnOp[];
    failure?: readonly TxnOp[];
  }): Promise<LaikaResult<EtcdTxnResult>> {
    // Encode every key/value crossing into the wire shape.
    const encodeOp = (op: TxnOp): Record<string, unknown> => {
      if ('requestPut' in op) {
        return { requestPut: { key: b64encode(op.requestPut.key), value: b64encode(op.requestPut.value) } };
      }
      if ('requestDeleteRange' in op) {
        return {
          requestDeleteRange: {
            key: b64encode(op.requestDeleteRange.key),
            ...(op.requestDeleteRange.rangeEnd !== undefined
              ? { rangeEnd: b64encode(op.requestDeleteRange.rangeEnd) }
              : {}),
          },
        };
      }
      return {
        requestRange: {
          key: b64encode(op.requestRange.key),
          ...(op.requestRange.rangeEnd !== undefined
            ? { rangeEnd: b64encode(op.requestRange.rangeEnd) }
            : {}),
          ...(op.requestRange.limit !== undefined ? { limit: op.requestRange.limit } : {}),
        },
      };
    };
    const encodeCompare = (c: TxnCompare): Record<string, unknown> => {
      const base: Record<string, unknown> = {
        target: c.target,
        result: c.result,
        key: b64encode(c.key),
      };
      if (c.target === 'CREATE') base['createRevision'] = c.createRevision;
      else base['modRevision'] = c.modRevision;
      return base;
    };

    const body: Record<string, unknown> = {};
    if (input.compare?.length) body['compare'] = input.compare.map(encodeCompare);
    if (input.success?.length) body['success'] = input.success.map(encodeOp);
    if (input.failure?.length) body['failure'] = input.failure.map(encodeOp);

    let response: Response;
    try {
      response = await this.request('POST', '/v3/kv/txn', body);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('etcd unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'txn');
    const parsed = await response.json() as { succeeded?: boolean; responses?: Array<Record<string, unknown>> };
    return Result.succeed({
      succeeded: parsed.succeeded ?? false,
      responses: parsed.responses ?? [],
    });
  }

  // ───────────────────────── plumbing ─────────────────────────

  private async kvRange(key: string, rangeEnd?: string, limit?: number): Promise<LaikaResult<EtcdKv[]>> {
    const body: Record<string, unknown> = { key: b64encode(key) };
    if (rangeEnd !== undefined) body['rangeEnd'] = b64encode(rangeEnd);
    if (limit !== undefined) body['limit'] = String(limit);

    let response: Response;
    try {
      response = await this.request('POST', '/v3/kv/range', body);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('etcd unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), key);

    const parsed = await response.json() as {
      kvs?: Array<{
        key: string;
        value: string;
        create_revision?: string;
        mod_revision?: string;
        version?: string;
        createRevision?: string;
        modRevision?: string;
      }>;
    };
    const out: EtcdKv[] = (parsed.kvs ?? []).map(kv => ({
      key: b64decode(kv.key),
      // empty value comes back as undefined from some etcd versions.
      value: kv.value ? b64decode(kv.value) : '',
      // The gateway emits both snake_case and camelCase depending on version;
      // accept either.
      createRevision: kv.create_revision ?? kv.createRevision ?? '0',
      modRevision: kv.mod_revision ?? kv.modRevision ?? '0',
      version: kv.version ?? '0',
    }));
    return Result.succeed(out);
  }

  private async accessToken(): Promise<string | undefined> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.token;
  }

  private async request(method: string, path: string, body: Record<string, unknown>): Promise<Response> {
    const token = await this.accessToken();
    return this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        // etcd's gateway accepts the auth token as `Authorization: <token>`
        // (no "Bearer" prefix). Cluster operators sometimes front it with
        // a reverse proxy that *does* expect Bearer; the `headers` opt
        // lets callers add whatever they need.
        ...(token ? { Authorization: token } : {}),
        ...(this.auth.headers ?? {}),
      },
      body: JSON.stringify(body),
    });
  }
}
