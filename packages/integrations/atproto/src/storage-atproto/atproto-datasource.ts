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
// AT Protocol (Bluesky) — XRPC repo endpoints
// ---------------------------------------------------------------------------
//
// AT Protocol is the federation protocol underlying Bluesky. Three traits
// set it structurally apart from every other backend in the Laika suite:
//
//   1. **DID-based repo identity.** Every record lives in a repo identified
//      by a DID (Decentralised Identifier — `did:plc:abc...` or `did:web:...`).
//      No "database name", no "bucket id" — the repo *is* the identity.
//
//   2. **Content addressable.** Every record carries a CID (Content
//      Identifier) — a SHA-256-based hash of the canonicalised CBOR
//      encoding. The CID changes on every update, surfacing as `revisionId`
//      in the storage repository. First content-addressable backend in
//      the suite.
//
//   3. **`applyWrites` with discriminated-union actions.** The atomic
//      multi-record write primitive takes an array of action objects, each
//      tagged with a `$type` URI:
//
//          {"$type": "com.atproto.repo.applyWrites#create", collection, rkey, value}
//          {"$type": "com.atproto.repo.applyWrites#update", collection, rkey, value}
//          {"$type": "com.atproto.repo.applyWrites#delete", collection, rkey}
//
//      The PDS commits the whole array atomically — same semantics as etcd
//      Txn or CouchDB bulk_docs, but with mixed create/update/delete in one
//      structurally-typed batch. **The 11th atomic-multi-write mechanism
//      in the suite.**

const DEFAULT_PDS_URL = 'https://bsky.social';

export interface AtprotoAuth {
  /** JWT from `POST /xrpc/com.atproto.server.createSession` (`accessJwt` field). */
  readonly accessJwt?: string;
  /** Async hook — overrides `accessJwt` when present. Refresh handling is the caller's. */
  readonly tokenProvider?: () => string | Promise<string>;
}

export interface AtprotoDataSourceOptions {
  readonly auth: AtprotoAuth;
  /** DID of the repo this data source writes to. */
  readonly repo: string;
  /** PDS base URL. Default `https://bsky.social`. */
  readonly pdsUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** A record record-pair as returned by `getRecord` / `listRecords`. */
export interface AtprotoRecord<T = Record<string, unknown>> {
  readonly uri: string; // `at://<did>/<collection>/<rkey>`
  readonly cid: string;
  readonly value: T;
}

/** One write within an `applyWrites` body. */
export type ApplyWritesAction =
  | {
    readonly $type: 'com.atproto.repo.applyWrites#create',
    readonly collection: string,
    readonly rkey: string,
    readonly value: Record<string, unknown>,
  }
  | {
    readonly $type: 'com.atproto.repo.applyWrites#update',
    readonly collection: string,
    readonly rkey: string,
    readonly value: Record<string, unknown>,
  }
  | {
    readonly $type: 'com.atproto.repo.applyWrites#delete',
    readonly collection: string,
    readonly rkey: string,
  };

/** One per-write result in the `applyWrites` response array. */
export interface ApplyWritesResult {
  readonly $type:
    | 'com.atproto.repo.applyWrites#createResult'
    | 'com.atproto.repo.applyWrites#updateResult'
    | 'com.atproto.repo.applyWrites#deleteResult';
  readonly uri?: string;
  readonly cid?: string;
  /** Only present when validation failed. */
  readonly validationStatus?: string;
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
    const parsed = JSON.parse(body) as { error?: string, message?: string };
    if (parsed.error) code = parsed.error;
    if (parsed.message) detail = `: ${parsed.message}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`AT Protocol authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`AT Protocol access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`AT Protocol record not found: ${context}`));
    case 409:
      return Result.fail(new EntryAlreadyExistsError(`AT Protocol conflict (${code}): ${context}${detail}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`AT Protocol rate-limited request for ${context}`));
    default:
      // AT Protocol returns 400 with `error: 'RecordAlreadyExists'` for
      // duplicate create — handle that here.
      if (status === 400 && code === 'RecordAlreadyExists') {
        return Result.fail(new EntryAlreadyExistsError(`AT Protocol record already exists: ${context}`));
      }
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`AT Protocol returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`AT Protocol returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the AT Protocol XRPC repo endpoints over `fetch`. Six endpoints
 * carry the work:
 *
 *  - `GET  /xrpc/com.atproto.repo.getRecord`    — fetch by `(repo, collection, rkey)`
 *  - `GET  /xrpc/com.atproto.repo.listRecords`  — paginated list with optional `rkeyStart`/`rkeyEnd` range
 *  - `POST /xrpc/com.atproto.repo.createRecord` — create-only (fails on duplicate rkey)
 *  - `POST /xrpc/com.atproto.repo.putRecord`    — upsert; supports `swapRecord` CAS via prior CID
 *  - `POST /xrpc/com.atproto.repo.deleteRecord` — delete by triple; supports `swapRecord` CAS
 *  - `POST /xrpc/com.atproto.repo.applyWrites`  — atomic batch of create/update/delete actions
 */
export class AtprotoDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: AtprotoAuth;
  private readonly pdsUrl: string;
  readonly repo: string;

  constructor(options: AtprotoDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via AtprotoDataSourceOptions.fetch',
      );
    }
    if (!options.auth.accessJwt && !options.auth.tokenProvider) {
      throw new InternalError(
        'AtprotoDataSource requires `auth.accessJwt` or `auth.tokenProvider`',
      );
    }
    if (!options.repo) {
      throw new InternalError('AtprotoDataSource requires a `repo` DID');
    }
    this.auth = options.auth;
    this.repo = options.repo;
    this.pdsUrl = (options.pdsUrl ?? DEFAULT_PDS_URL).replace(/\/+$/, '');
  }

  /** Fetch a single record. `null` on 404. */
  async getRecord<T = Record<string, unknown>>(
    collection: string,
    rkey: string,
  ): Promise<LaikaResult<AtprotoRecord<T> | null>> {
    const url = new URL(`${this.pdsUrl}/xrpc/com.atproto.repo.getRecord`);
    url.searchParams.set('repo', this.repo);
    url.searchParams.set('collection', collection);
    url.searchParams.set('rkey', rkey);
    let response: Response;
    try {
      response = await this.request('GET', url.toString());
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('AT Protocol PDS unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `${collection}/${rkey}`);
    return Result.succeed(await response.json() as AtprotoRecord<T>);
  }

  /**
   * List records in a collection, optionally bounded by `[rkeyStart, rkeyEnd)`.
   * AT Protocol's `listRecords` supports rkey range bounds — same idiom as
   * etcd's [key, range_end) prefix scan, but on the rkey alphabet.
   */
  async listRecords<T = Record<string, unknown>>(
    collection: string,
    options: { rkeyStart?: string, rkeyEnd?: string, limit?: number, cursor?: string, reverse?: boolean } = {},
  ): Promise<LaikaResult<{ records: AtprotoRecord<T>[], cursor?: string }>> {
    const url = new URL(`${this.pdsUrl}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set('repo', this.repo);
    url.searchParams.set('collection', collection);
    if (options.limit !== undefined) url.searchParams.set('limit', String(options.limit));
    if (options.cursor) url.searchParams.set('cursor', options.cursor);
    if (options.rkeyStart) url.searchParams.set('rkeyStart', options.rkeyStart);
    if (options.rkeyEnd) url.searchParams.set('rkeyEnd', options.rkeyEnd);
    if (options.reverse) url.searchParams.set('reverse', 'true');

    let response: Response;
    try {
      response = await this.request('GET', url.toString());
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('AT Protocol PDS unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `listRecords(${collection})`);
    const body = await response.json() as { records?: AtprotoRecord<T>[], cursor?: string };
    return Result.succeed({ records: body.records ?? [], cursor: body.cursor });
  }

  /** Create a record. Fails with `RecordAlreadyExists` if `rkey` is taken. */
  async createRecord(
    collection: string,
    rkey: string,
    value: Record<string, unknown>,
  ): Promise<LaikaResult<{ uri: string, cid: string }>> {
    return this.writeRecord('createRecord', { repo: this.repo, collection, rkey, record: value });
  }

  /** Upsert a record by `(collection, rkey)`. Optional `swapRecord` CAS by prior CID. */
  async putRecord(
    collection: string,
    rkey: string,
    value: Record<string, unknown>,
    options: { swapRecord?: string } = {},
  ): Promise<LaikaResult<{ uri: string, cid: string }>> {
    return this.writeRecord('putRecord', {
      repo: this.repo,
      collection,
      rkey,
      record: value,
      ...(options.swapRecord ? { swapRecord: options.swapRecord } : {}),
    });
  }

  /** Delete by triple. Optional `swapRecord` CAS by prior CID. */
  async deleteRecord(
    collection: string,
    rkey: string,
    options: { swapRecord?: string } = {},
  ): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('POST', `${this.pdsUrl}/xrpc/com.atproto.repo.deleteRecord`, {
        body: JSON.stringify({
          repo: this.repo,
          collection,
          rkey,
          ...(options.swapRecord ? { swapRecord: options.swapRecord } : {}),
        }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('AT Protocol PDS unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `${collection}/${rkey}`);
    return Result.succeed(undefined);
  }

  /**
   * Atomic batch of writes. Each action is a discriminated-union object
   * tagged with `$type: 'com.atproto.repo.applyWrites#{create|update|delete}'`.
   * The PDS commits the whole array atomically — partial failures roll
   * back.
   */
  async applyWrites(
    writes: readonly ApplyWritesAction[],
    options: { validate?: boolean } = {},
  ): Promise<LaikaResult<ApplyWritesResult[]>> {
    if (writes.length === 0) return Result.succeed([]);
    let response: Response;
    try {
      response = await this.request('POST', `${this.pdsUrl}/xrpc/com.atproto.repo.applyWrites`, {
        body: JSON.stringify({
          repo: this.repo,
          writes,
          ...(options.validate !== undefined ? { validate: options.validate } : {}),
        }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('AT Protocol PDS unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'applyWrites');
    const body = await response.json() as { results?: ApplyWritesResult[] };
    return Result.succeed(body.results ?? []);
  }

  // ───────────────────────── plumbing ─────────────────────────

  private async writeRecord(
    method: 'createRecord' | 'putRecord',
    body: Record<string, unknown>,
  ): Promise<LaikaResult<{ uri: string, cid: string }>> {
    let response: Response;
    try {
      response = await this.request('POST', `${this.pdsUrl}/xrpc/com.atproto.repo.${method}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('AT Protocol PDS unreachable', { cause }));
    }
    if (!response.ok) {
      const collection = body['collection'] ?? '';
      const rkey = body['rkey'] ?? '';
      return errorForResponse(response.status, await safeText(response), `${collection}/${rkey}`);
    }
    const out = await response.json() as { uri: string, cid: string };
    return Result.succeed({ uri: out.uri, cid: out.cid });
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.accessJwt as string;
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: BodyInit, headers?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.accessToken();
    return this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
      body: init?.body,
    });
  }
}

// ---------------------------------------------------------------------------
// Path ↔ rkey conversion
// ---------------------------------------------------------------------------
//
// AT Protocol rkeys must match `^[a-zA-Z0-9_~.:-]{1,512}$`. `/` is not
// allowed — and that's the only character we strictly need to encode for
// Laika paths. We pick `:` (already in the allowed set) as the path
// delimiter.

/** Convert a Laika path to an AT Protocol rkey. `notes/hello` → `notes:hello`. */
export const pathToRkey = (path: string): string => {
  const stripped = path.replace(/^\/+|\/+$/g, '');
  return stripped.replace(/\//g, ':');
};

/** Inverse of {@link pathToRkey}. */
export const rkeyToPath = (rkey: string): string => rkey.replace(/:/g, '/');
