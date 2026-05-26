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
// Gel (formerly EdgeDB) HTTP EdgeQL endpoint
// ---------------------------------------------------------------------------
//
// Gel is an object-relational database — first-class object types with
// links (instead of foreign keys), schema-first migrations, and EdgeQL
// as its query language. Three traits set the wire shape apart from
// every prior backend in the Laika suite:
//
//   1. **EdgeQL object-shape literals.** Both reads and writes use a
//      shape grammar — `INSERT LaikaFile { path := $path }` (note `:=`)
//      and `SELECT LaikaFile { id, path, content }`. The `:=` operator
//      distinguishes "assign to property" from `=` (equality comparison).
//
//   2. **`<type>$param` typed-parameter casts.** Parameter references
//      carry their type in the query text itself: `<str>$path`,
//      `<array<str>>$paths`. The wire format propagates this to the
//      backend's planner — different from any prior parameter syntax
//      (libSQL's `?`, SurrealDB's `$name`, PostgreSQL's `$1`).
//
//   3. **`FOR x IN ... UNION ( query x )` for atomic batching.** Set
//      comprehensions iterate a parameter array, running the same
//      query against each element. Single statement; one transaction.
//      `removeAtoms(N)` ships as one such query — **the 15th
//      structurally distinct atomic-multi-write mechanism in the
//      Laika suite.**

const DEFAULT_BASE_URL = 'http://localhost:5656';
const DEFAULT_BRANCH = 'main';

export interface GelAuth {
  /**
   * HTTP Basic credentials — typical self-hosted setup with a role's
   * password (`gel ui` → Settings → Authentication for password reset).
   */
  readonly basic?: { username: string, password: string };
  /** Bearer JWT — Gel Cloud / SSO-fronted deployments. */
  readonly bearer?: string;
  /** Async hook — overrides the static auth fields. */
  readonly headerProvider?: () => Record<string, string> | Promise<Record<string, string>>;
}

export interface GelDataSourceOptions {
  /** Base URL of the Gel HTTP server — `http://host:5656`. */
  readonly url?: string;
  /** Branch name; default `main`. (Older EdgeDB called these "databases".) */
  readonly branch?: string;
  readonly auth?: GelAuth;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Response envelope from `POST /branch/{branch}/edgeql`. */
export interface EdgeqlResult<T = unknown> {
  readonly data?: T[];
  readonly error?: { readonly code?: number, readonly type?: string, readonly message?: string };
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
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string, message?: string } };
    if (parsed.error?.message) detail = `: ${parsed.error.message}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Gel authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Gel access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Gel endpoint not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Gel rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Gel returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Gel returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Map an EdgeQL-level error (HTTP 200 with `{error}` body, or a thrown
 * exception type tagged with `gel.errors.ConstraintViolationError`) to
 * a typed Laika error.
 */
const errorForEdgeql = (
  error: { type?: string, message?: string },
  context: string,
): NotFoundError | EntryAlreadyExistsError | InternalError => {
  const type = error.type ?? '';
  const message = error.message ?? '';
  // Constraint violations — the canonical "unique" enforcement.
  if (
    /ConstraintViolationError|ExclusivityViolationError/i.test(type)
    || /violates exclusivity constraint|constraint violation/i.test(message)
  ) {
    return new EntryAlreadyExistsError(`Gel constraint violation for ${context}: ${message}`);
  }
  if (/NoDataError|MissingRequiredError/i.test(type)) {
    return new NotFoundError(`Gel data missing for ${context}: ${message}`);
  }
  return new InternalError(`Gel EdgeQL error for ${context} (${type}): ${message}`);
};

/**
 * Talks the Gel HTTP EdgeQL endpoint over `fetch`.
 *
 * Single endpoint:
 *
 *  - `POST /branch/{branch}/edgeql` — accepts `{query, variables}` in
 *    the JSON body; returns `{data: T[]}` on success or
 *    `{error: {...}}` on EdgeQL-level failure. The whole query runs
 *    as one transaction by default — multi-statement bodies (joined
 *    by `;`) commit atomically.
 */
export class GelDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: GelAuth;
  private readonly apiUrl: string;
  readonly branch: string;

  constructor(options: GelDataSourceOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via GelDataSourceOptions.fetch',
      );
    }
    this.auth = options.auth ?? {};
    this.apiUrl = (options.url ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.branch = options.branch ?? DEFAULT_BRANCH;
  }

  /**
   * Fire one EdgeQL query and return its `data` array. Each query runs
   * as one transaction at the endpoint — multi-statement bodies (joined
   * by `;`) commit atomically.
   *
   * @example
   * ```ts
   * await dataSource.query<{id: string; path: string}>(
   *   'SELECT LaikaFile { id, path } FILTER .name = <str>$name LIMIT 1',
   *   { name: 'hello' },
   * );
   * ```
   */
  async query<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<LaikaResult<T[]>> {
    const url = `${this.apiUrl}/branch/${encodeURIComponent(this.branch)}/edgeql`;
    let response: Response;
    try {
      response = await this.request('POST', url, { query, variables });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Gel unreachable', { cause }));
    }
    if (!response.ok) {
      const text = await safeText(response);
      // Some Gel error responses come as HTTP 4xx with the `error` field
      // populated; surface the EdgeQL-level error if recognisable.
      try {
        const parsed = JSON.parse(text) as EdgeqlResult<T>;
        if (parsed.error) {
          return Result.fail(errorForEdgeql(parsed.error, query.slice(0, 60)));
        }
      } catch { /* not JSON */ }
      return errorForResponse(response.status, text, query.slice(0, 60));
    }
    const envelope = await response.json() as EdgeqlResult<T>;
    if (envelope.error) {
      return Result.fail(errorForEdgeql(envelope.error, query.slice(0, 60)));
    }
    return Result.succeed(envelope.data ?? []);
  }

  /** Convenience — return the first row of a query, or `null` when empty. */
  async one<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<LaikaResult<T | null>> {
    const r = await this.query<T>(query, variables);
    if (Result.isFailure(r)) return Result.fail(r.failure);
    return Result.succeed(r.success[0] ?? null);
  }

  // ───────────────────────── plumbing ─────────────────────────

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.auth.headerProvider) return await this.auth.headerProvider();
    const out: Record<string, string> = {};
    if (this.auth.basic) {
      const { username, password } = this.auth.basic;
      out['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
    } else if (this.auth.bearer) {
      out['Authorization'] = `Bearer ${this.auth.bearer}`;
    }
    return out;
  }

  private async request(method: string, url: string, body: unknown): Promise<Response> {
    const auth = await this.authHeaders();
    return this.fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...auth,
      },
      body: JSON.stringify(body),
    });
  }
}
