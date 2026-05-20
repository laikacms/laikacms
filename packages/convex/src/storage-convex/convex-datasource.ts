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
// Convex HTTP RPC data source
// ---------------------------------------------------------------------------
//
// Convex is a reactive database where queries and mutations are written as
// server-side TypeScript functions, not query strings. Clients invoke
// these functions by *name* over HTTP. Five traits set the wire shape
// apart from every prior backend in the Laika suite:
//
//   1. **Named-function RPC as the primitive.** The wire shape is
//      `POST /api/query` (or `/api/mutation`) with body
//      `{path: "laika:getFile", args: {...}, format: "json"}`. The
//      function name travels in the body under `path`, not the URL.
//      **First "platform-as-API" backend** — no SQL/Mango/Cypher; the
//      query DSL is user-controlled TypeScript on the Convex side.
//
//   2. **`{status, value | errorMessage}` envelope.** Every response —
//      regardless of HTTP status — wraps the payload in a discriminated
//      envelope: `{status: "success", value: …}` or `{status: "error",
//      errorMessage: "…"}`. First backend with explicit success/error
//      discriminator at the envelope level (not just HTTP status).
//
//   3. **Query / Mutation / Action triad.** Convex distinguishes:
//        - **Queries** — pure reads, deterministic, can be subscribed to
//        - **Mutations** — database writes, transactional
//        - **Actions** — side-effecting calls (e.g. external HTTP)
//      The repository uses only `query` and `mutation`. First backend
//      with this read/write/side-effect endpoint distinction.
//
//   4. **Transactional mutations.** Every mutation call runs as a single
//      transaction. `removeAtoms(N)` ships as ONE mutation call with
//      the path array as a parameter; the user's function deletes N
//      rows in one transaction. Different *delivery* of the batch
//      from prior atomic mechanisms — atomicity lives in the
//      user-defined function, not the wire protocol.
//
//   5. **Per-deployment URL.** Each Convex deployment has its own
//      hostname like `https://<deployment-slug>.convex.cloud`. No
//      database name in the URL — the deployment IS the database.

const DEFAULT_FORMAT = 'json' as const;

export interface ConvexAuth {
  /** JWT for an authenticated Convex deployment. */
  readonly accessToken?: string;
  /** Async hook — overrides `accessToken` when present. */
  readonly tokenProvider?: () => string | Promise<string>;
}

export interface ConvexDataSourceOptions {
  /**
   * Convex deployment URL — e.g. `https://my-app-name-123.convex.cloud`.
   * Trailing slash is stripped automatically.
   */
  readonly url: string;
  readonly auth?: ConvexAuth;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Convex response envelope — always one of these two shapes. */
export type ConvexResponse<T> =
  | { readonly status: 'success'; readonly value: T; readonly logLines?: string[] }
  | { readonly status: 'error'; readonly errorMessage: string; readonly errorData?: unknown; readonly logLines?: string[] };

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  const detail = body ? `: ${body.slice(0, 200)}` : '';
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Convex authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Convex access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Convex endpoint not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Convex rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Convex returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Convex returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Recognise Convex's canonical error strings and map to typed Laika errors.
 * Convex doesn't surface error codes — `errorMessage` is a free-form string,
 * sometimes with a class name prefix (e.g. `[CONVEX M(laika:create)]
 * Uncaught Error: …`). We do a best-effort pattern match.
 */
const errorForConvexError = (
  message: string,
  context: string,
): NotFoundError | EntryAlreadyExistsError | InternalError => {
  if (/already exists|unique constraint|duplicate/i.test(message)) {
    return new EntryAlreadyExistsError(`Convex error for ${context}: ${message}`);
  }
  if (/not found|missing/i.test(message)) {
    return new NotFoundError(`Convex error for ${context}: ${message}`);
  }
  return new InternalError(`Convex error for ${context}: ${message}`);
};

/**
 * Talks the Convex HTTP RPC endpoint over `fetch`. Two methods:
 *
 *  - {@link query} — POST `/api/query` for pure reads. The function path
 *    (e.g. `laika:getFile`) and args go in the JSON body.
 *
 *  - {@link mutation} — POST `/api/mutation` for transactional writes.
 *    Each mutation runs as one transaction.
 *
 * Both unwrap the `{status, value | errorMessage}` envelope automatically.
 * The "context" passed for error messages is the function path.
 */
export class ConvexDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: ConvexAuth;
  readonly url: string;

  constructor(options: ConvexDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via ConvexDataSourceOptions.fetch',
      );
    }
    if (!options.url) throw new InternalError('ConvexDataSource requires `url`');
    this.auth = options.auth ?? {};
    this.url = options.url.replace(/\/+$/, '');
  }

  /**
   * Invoke a Convex query by path — e.g. `query('laika:getFile', {parent, name})`.
   * Returns the unwrapped `value` on success; maps Convex error envelopes to
   * typed Laika errors.
   */
  async query<T = unknown>(
    path: string,
    args: Record<string, unknown> = {},
  ): Promise<LaikaResult<T>> {
    return this.invoke<T>('query', path, args);
  }

  /** Invoke a Convex mutation by path. Runs as one transaction. */
  async mutation<T = unknown>(
    path: string,
    args: Record<string, unknown> = {},
  ): Promise<LaikaResult<T>> {
    return this.invoke<T>('mutation', path, args);
  }

  // ───────────────────────── plumbing ─────────────────────────

  private async invoke<T>(
    kind: 'query' | 'mutation',
    path: string,
    args: Record<string, unknown>,
  ): Promise<LaikaResult<T>> {
    const endpoint = `${this.url}/api/${kind}`;
    let response: Response;
    try {
      response = await this.request('POST', endpoint, {
        path,
        args,
        format: DEFAULT_FORMAT,
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Convex unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), path);
    const envelope = await response.json() as ConvexResponse<T>;
    if (envelope.status === 'error') {
      return Result.fail(errorForConvexError(envelope.errorMessage, path));
    }
    return Result.succeed(envelope.value);
  }

  private async accessToken(): Promise<string | null> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.accessToken ?? null;
  }

  private async request(method: string, url: string, body: unknown): Promise<Response> {
    const token = await this.accessToken();
    return this.fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }
}
