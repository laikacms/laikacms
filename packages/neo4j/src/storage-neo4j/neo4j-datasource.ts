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
// Neo4j transactional HTTP endpoint
// ---------------------------------------------------------------------------
//
// Neo4j is a native graph database with Cypher as its query language.
// Three traits set the wire shape apart from every prior backend:
//
//   1. **Implicit transaction boundary at the endpoint.** `POST /db/{db}/tx/commit`
//      runs the entire body as one transaction — multi-statement batches
//      are atomic by construction, no `BEGIN`/`COMMIT` keywords required
//      (vs SurrealDB iter 32). Per-statement results come back in a
//      `results[]` array. **The 14th structurally distinct atomic-multi-write
//      mechanism in the Laika suite.**
//
//   2. **Per-statement parameters in the JSON body.** Each statement carries
//      its own `parameters` map — unlike libSQL (which puts vars in the URL
//      query string globally) or SurrealDB (which scope-renames vars within
//      a single SurQL pipeline), Neo4j keeps statement and parameters
//      bundled together as one record.
//
//   3. **`resultDataContents` controls the row shape.** Each statement
//      can ask for `row` (default — list of values), `graph` (node + edge
//      objects), or `rest` (full REST-style metadata). The repository
//      always asks for `row`; users wanting graph projections can opt in
//      at the data-source layer.

const DEFAULT_BASE_URL = 'http://localhost:7474';
const DEFAULT_DATABASE = 'neo4j';

export interface Neo4jAuth {
  /** HTTP Basic — the conventional Neo4j credentials shape. */
  readonly basic?: { username: string; password: string };
  /** Bearer — for Neo4j AuraDB and SSO-fronted deployments. */
  readonly bearer?: string;
  /** Async hook — overrides the static auth fields. */
  readonly headerProvider?: () => Record<string, string> | Promise<Record<string, string>>;
}

export interface Neo4jDataSourceOptions {
  readonly auth?: Neo4jAuth;
  /** Base URL of the Neo4j HTTP API — `http://host:7474`. */
  readonly url?: string;
  /** Database name; default `neo4j`. */
  readonly database?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

export interface CypherStatement {
  readonly statement: string;
  readonly parameters?: Record<string, unknown>;
  readonly resultDataContents?: ReadonlyArray<'row' | 'graph' | 'rest'>;
}

/** One per-statement result envelope in the `/tx/commit` response. */
export interface CypherResult {
  readonly columns: readonly string[];
  readonly data: ReadonlyArray<{ row: readonly unknown[]; meta?: unknown }>;
}

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ code?: string; message?: string }> };
    if (parsed.errors?.length) {
      detail = ': ' + parsed.errors.map(e => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ');
    }
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Neo4j authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Neo4j access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Neo4j endpoint not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Neo4j rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Neo4j returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Neo4j returned HTTP ${status} for ${context}${detail}`));
  }
};

/** Cypher-level errors come back in the `errors[]` array even on HTTP 200. */
const errorForCypher = (
  error: { code?: string; message?: string },
  context: string,
): NotFoundError | EntryAlreadyExistsError | InternalError => {
  const code = error.code ?? '';
  const message = error.message ?? '';
  // Neo4j's canonical "constraint violation" error code.
  if (code.includes('ConstraintValidationFailed') || /already exists/i.test(message)) {
    return new EntryAlreadyExistsError(`Neo4j constraint violation for ${context}: ${message}`);
  }
  if (code.includes('EntityNotFound')) {
    return new NotFoundError(`Neo4j entity not found for ${context}: ${message}`);
  }
  return new InternalError(`Neo4j Cypher error for ${context} (${code}): ${message}`);
};

/**
 * Talks the Neo4j transactional HTTP endpoint over `fetch`.
 *
 * Single endpoint:
 *
 *  - `POST /db/{database}/tx/commit` — accepts a `{statements: [...]}`
 *    body and runs every statement as one atomic transaction. Returns a
 *    `{results: [...], errors: [...]}` envelope; per-statement results
 *    are in `results[]` (one per statement), and any Cypher-level
 *    failures appear in `errors[]`.
 *
 * Higher-level helpers:
 *  - {@link run}     — fire one statement; unwrap to its single result.
 *  - {@link batch}   — fire N statements as one atomic transaction.
 */
export class Neo4jDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: Neo4jAuth;
  private readonly apiUrl: string;
  readonly database: string;

  constructor(options: Neo4jDataSourceOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via Neo4jDataSourceOptions.fetch',
      );
    }
    this.auth = options.auth ?? {};
    this.apiUrl = (options.url ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.database = options.database ?? DEFAULT_DATABASE;
  }

  /**
   * Fire one Cypher statement and unwrap to its single result envelope.
   * The whole thing is still wrapped in a transaction at the endpoint —
   * use {@link batch} when you need multiple statements to commit
   * atomically.
   */
  async run(
    statement: string,
    parameters: Record<string, unknown> = {},
  ): Promise<LaikaResult<CypherResult>> {
    const r = await this.batch([{ statement, parameters }]);
    if (Result.isFailure(r)) return Result.fail(r.failure);
    const first = r.success[0];
    if (!first) return Result.fail(new InternalError('Neo4j run() returned no result'));
    return Result.succeed(first);
  }

  /**
   * Fire N statements as ONE transactional commit. The entire batch is
   * atomic — partial failures roll back. Per-statement results come back
   * in the same order in the response array.
   */
  async batch(statements: ReadonlyArray<CypherStatement>): Promise<LaikaResult<CypherResult[]>> {
    if (statements.length === 0) return Result.succeed([]);
    const body = {
      statements: statements.map(s => ({
        statement: s.statement,
        parameters: s.parameters ?? {},
        resultDataContents: s.resultDataContents ?? ['row'],
      })),
    };

    let response: Response;
    try {
      const url = `${this.apiUrl}/db/${encodeURIComponent(this.database)}/tx/commit`;
      response = await this.request('POST', url, body);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Neo4j unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'tx/commit');
    const envelope = await response.json() as {
      results?: CypherResult[];
      errors?: Array<{ code?: string; message?: string }>;
    };
    if (envelope.errors && envelope.errors.length > 0) {
      // The first Cypher-level error is the most informative; surface it.
      const err = envelope.errors[0]!;
      return Result.fail(errorForCypher(err, 'tx/commit'));
    }
    return Result.succeed(envelope.results ?? []);
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

/**
 * Extract the first node row from a Cypher result envelope. Neo4j returns
 * each row as `{row: [<node-props-object>, ...]}` — for `RETURN f` style
 * queries we just want the props object.
 */
export const firstNodeProps = <T = Record<string, unknown>>(result: CypherResult): T | null => {
  const row = result.data[0]?.row;
  if (!row || row.length === 0) return null;
  return row[0] as T;
};

/** Map every row's first column. */
export const allNodeProps = <T = Record<string, unknown>>(result: CypherResult): T[] => {
  return result.data.flatMap(d => {
    const first = d.row[0];
    return first === undefined ? [] : [first as T];
  });
};
