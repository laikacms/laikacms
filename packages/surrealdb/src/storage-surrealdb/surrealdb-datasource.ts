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
// SurrealDB HTTP/SurQL data source
// ---------------------------------------------------------------------------
//
// SurrealDB is a multi-model database — documents, graph relations, KV, and
// relational rows all live in the same namespace. Four traits set the wire
// shape apart from every other SQL-ish backend in the suite:
//
//   1. **Record IDs are first-class composite handles.** A record id is
//      `<table>:<id>` — not a `(table, id)` tuple. The SurQL idiom for
//      safely constructing them is `type::thing("table", $id)`. The data
//      source emits this in every operation that touches a specific record.
//
//   2. **NS / DB header isolation.** Namespace and database aren't part of
//      the URL path or query string — they're HTTP request headers (`NS:`,
//      `DB:`). First backend in the Laika suite with header-based
//      tenancy. Multiple Laika instances share a cluster by passing
//      distinct (NS, DB) pairs.
//
//   3. **`BEGIN TRANSACTION; …; COMMIT TRANSACTION;` as the atomic
//      primitive.** SurQL statements are semicolon-delimited; wrapping
//      N of them between an explicit BEGIN/COMMIT and posting the whole
//      string to `/sql` runs the lot as one transaction. Returns one
//      result envelope per statement. **The 12th structurally distinct
//      atomic-multi-write mechanism in the Laika suite.**
//
//   4. **Per-statement result envelopes.** `POST /sql` always returns an
//      array — one entry per statement — each with `{status, time, result}`.
//      Even single-statement calls follow this shape, so callers always
//      destructure `[0]`.

const DEFAULT_API_URL = 'http://localhost:8000';

export interface SurrealDbAuth {
  /** Pre-acquired JWT, e.g. from `POST /signin`. */
  readonly token?: string;
  /** Async hook — overrides `token` when present. */
  readonly tokenProvider?: () => string | Promise<string>;
  /** HTTP Basic — convenience for self-hosted dev clusters with root creds. */
  readonly basic?: { username: string; password: string };
}

export interface SurrealDbDataSourceOptions {
  /** Base URL — e.g. `http://localhost:8000` or `https://surreal.example.com`. */
  readonly url?: string;
  /** SurrealDB namespace. Sent as the `NS:` header on every request. */
  readonly namespace: string;
  /** SurrealDB database. Sent as the `DB:` header on every request. */
  readonly database: string;
  readonly auth?: SurrealDbAuth;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** One per-statement response in the array returned by `POST /sql`. */
export interface SurqlStatementResult {
  readonly status: 'OK' | 'ERR';
  readonly time: string;
  readonly result: unknown;
}

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { information?: string; description?: string; details?: string };
    const msg = parsed.information ?? parsed.description ?? parsed.details;
    if (msg) detail = `: ${msg}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`SurrealDB authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`SurrealDB access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`SurrealDB resource not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`SurrealDB rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`SurrealDB returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`SurrealDB returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Recognise a SurrealDB unique-constraint failure (raised by `DEFINE INDEX
 * ... UNIQUE` on a write) and map it to {@link EntryAlreadyExistsError}.
 */
const errorForStatement = (statement: SurqlStatementResult, context: string): InternalError | EntryAlreadyExistsError => {
  const message = typeof statement.result === 'string'
    ? statement.result
    : JSON.stringify(statement.result);
  if (/already exists|duplicate|UNIQUE|unique key violation/i.test(message)) {
    return new EntryAlreadyExistsError(`SurrealDB unique constraint for ${context}: ${message}`);
  }
  return new InternalError(`SurrealDB statement failed for ${context}: ${message}`);
};

/**
 * Talks the SurrealDB HTTP API. Single endpoint:
 *
 *  - `POST /sql` — accepts SurQL text in the body; returns a JSON array
 *    of per-statement `{status, time, result}` envelopes. Auth via
 *    `Authorization: Bearer …` or `Authorization: Basic …`; namespace
 *    and database via the `NS:` and `DB:` headers.
 *
 * The repository never touches the `/key/{table}/{id}` REST endpoints
 * directly — every operation flows through SurQL so that the
 * single-statement and transaction paths share the same plumbing.
 */
export class SurrealDbDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: SurrealDbAuth;
  private readonly apiUrl: string;
  readonly namespace: string;
  readonly database: string;

  constructor(options: SurrealDbDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via SurrealDbDataSourceOptions.fetch',
      );
    }
    if (!options.namespace) throw new InternalError('SurrealDbDataSource requires `namespace`');
    if (!options.database) throw new InternalError('SurrealDbDataSource requires `database`');
    this.auth = options.auth ?? {};
    this.namespace = options.namespace;
    this.database = options.database;
    this.apiUrl = (options.url ?? DEFAULT_API_URL).replace(/\/+$/, '');
  }

  /**
   * Fire a single SurQL statement (or any number of semicolon-separated
   * statements that should NOT be wrapped in a transaction). Returns one
   * envelope per statement; the caller picks the index they want.
   *
   * For parameterised queries, pass `vars` — SurrealDB substitutes them
   * via the `?<var>=<value>` query string (kept JSON-safe by serialising
   * each value to JSON).
   */
  async query(
    surql: string,
    vars: Record<string, unknown> = {},
  ): Promise<LaikaResult<SurqlStatementResult[]>> {
    const url = new URL(`${this.apiUrl}/sql`);
    for (const [k, v] of Object.entries(vars)) {
      url.searchParams.set(k, JSON.stringify(v));
    }
    let response: Response;
    try {
      response = await this.request('POST', url.toString(), surql);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('SurrealDB unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), surql.slice(0, 60));
    const body = await response.json() as SurqlStatementResult[];
    return Result.succeed(body);
  }

  /**
   * Wrap N SurQL statements in `BEGIN TRANSACTION; … COMMIT TRANSACTION;`
   * and run them as one atomic transaction. The wire shape is one
   * `POST /sql` body containing all the statements concatenated by `;`.
   *
   * Returns the per-statement results for the statements INSIDE the
   * transaction — the BEGIN/COMMIT envelopes are stripped.
   */
  async transaction(
    statements: ReadonlyArray<{ surql: string; vars?: Record<string, unknown> }>,
  ): Promise<LaikaResult<SurqlStatementResult[]>> {
    if (statements.length === 0) return Result.succeed([]);

    // Vars are global to the whole request — namespace them so collisions
    // between statements can't happen.
    const allVars: Record<string, unknown> = {};
    const namespacedStatements = statements.map((s, i) => {
      let rewritten = s.surql;
      for (const [k, v] of Object.entries(s.vars ?? {})) {
        const newName = `${k}_${i}`;
        // Replace `$k` with `$k_i` (only when it stands alone — naïve
        // regex on `\$k\b` is good enough for our internal SurQL).
        rewritten = rewritten.replace(new RegExp(`\\$${k}\\b`, 'g'), `$${newName}`);
        allVars[newName] = v;
      }
      return rewritten;
    });

    const surql = `BEGIN TRANSACTION;\n${namespacedStatements.join(';\n')};\nCOMMIT TRANSACTION;`;
    const result = await this.query(surql, allVars);
    if (Result.isFailure(result)) return Result.fail(result.failure);
    // Strip the BEGIN and COMMIT envelopes (first and last entries).
    const inner = result.success.slice(1, -1);
    // Surface the first failing statement, if any.
    for (let i = 0; i < inner.length; i += 1) {
      const s = inner[i];
      if (s && s.status === 'ERR') {
        return Result.fail(errorForStatement(s, `transaction step ${i}`));
      }
    }
    return Result.succeed(inner);
  }

  /** Convenience — run a single statement and unwrap to its `result`. */
  async one<T>(surql: string, vars: Record<string, unknown> = {}): Promise<LaikaResult<T>> {
    const r = await this.query(surql, vars);
    if (Result.isFailure(r)) return Result.fail(r.failure);
    const first = r.success[0];
    if (!first) return Result.fail(new InternalError(`SurrealDB query returned no result: ${surql.slice(0, 60)}`));
    if (first.status === 'ERR') return Result.fail(errorForStatement(first, surql.slice(0, 60)));
    return Result.succeed(first.result as T);
  }

  // ───────────────────────── plumbing ─────────────────────────

  private async authHeader(): Promise<string | null> {
    if (this.auth.tokenProvider) return `Bearer ${await this.auth.tokenProvider()}`;
    if (this.auth.token) return `Bearer ${this.auth.token}`;
    if (this.auth.basic) {
      const { username, password } = this.auth.basic;
      // btoa works for ASCII basic-auth pairs; SurrealDB usernames are ASCII.
      return `Basic ${btoa(`${username}:${password}`)}`;
    }
    return null;
  }

  private async request(method: string, url: string, body: string): Promise<Response> {
    const auth = await this.authHeader();
    return this.fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'text/plain',
        // The defining trait — namespace and database via headers, not paths.
        NS: this.namespace,
        DB: this.database,
        ...(auth ? { Authorization: auth } : {}),
      },
      body,
    });
  }
}
