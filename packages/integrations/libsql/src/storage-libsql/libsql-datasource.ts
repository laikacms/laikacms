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
// libSQL / Turso hrana HTTP pipeline protocol
// ---------------------------------------------------------------------------
//
// libSQL's HTTP API is `POST /v2/pipeline` with a `{requests: [...]}` body.
// Each request is one of:
//
//   - `execute` — run a single SQL statement
//   - `batch`   — run multiple statements as one conditional sequence;
//                 each step has a `condition` that gates whether it runs
//                 (default: previous step succeeded). The whole batch is
//                 atomic.
//   - `close`   — close the server-side session
//
// Two protocol traits distinguish this from Cloudflare D1 (the other
// SQLite-on-HTTP backend in the suite):
//
//   1. **Typed argument encoding.** Args aren't bare positional `?` params;
//      they're typed objects: `{type: "text", value: "..."}`,
//      `{type: "integer", value: "42"}` (string!), `{type: "null"}`,
//      `{type: "blob", base64: "..."}`, `{type: "float", value: 3.14}`.
//      The `bind()` helper handles the JS-to-wire conversion.
//
//   2. **Multi-statement pipelines.** A single HTTP request can carry N
//      statements; the server executes them in order over one connection,
//      returning N results in the same response array. The repository
//      exploits this for `removeAtoms` (the 8th structurally distinct
//      atomic-multi-write mechanism in the Laika suite — `batch` request
//      with one step per key).

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

// ---------------------------------------------------------------------------
// Public auth / options
// ---------------------------------------------------------------------------

export interface LibSqlAuth {
  /** JWT from the Turso dashboard, or a libSQL auth token. */
  readonly token?: string;
  /** Async hook — overrides `token` when present. */
  readonly tokenProvider?: () => string | Promise<string>;
}

export interface LibSqlDataSourceOptions {
  /** Base URL — `https://<db>.turso.io` for Turso; `http://localhost:8080` for sqld. */
  readonly url: string;
  readonly auth?: LibSqlAuth;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** A typed argument in the libSQL wire format. */
export type LibSqlArg =
  | { type: 'null' }
  | { type: 'integer', value: string }
  | { type: 'float', value: number }
  | { type: 'text', value: string }
  | { type: 'blob', base64: string };

export interface LibSqlStatement {
  sql: string;
  args?: LibSqlArg[];
  named_args?: Array<{ name: string, value: LibSqlArg }>;
}

export interface LibSqlBatchStep {
  stmt: LibSqlStatement;
  /** Default: only run if all prior steps succeeded. */
  condition?:
    | { type: 'ok', step: number }
    | { type: 'error', step: number }
    | { type: 'not', cond: LibSqlBatchStep['condition'] }
    | { type: 'and', conds: Array<LibSqlBatchStep['condition']> }
    | { type: 'or', conds: Array<LibSqlBatchStep['condition']> };
}

export interface LibSqlExecuteResult {
  cols: Array<{ name: string, decltype?: string }>;
  rows: LibSqlArg[][];
  affected_row_count: number;
  last_insert_rowid?: string;
}

// ---------------------------------------------------------------------------
// Arg binding helpers — JS → wire / wire → JS
// ---------------------------------------------------------------------------

/**
 * Convert a JS value to a typed libSQL argument. Mirrors the official
 * client's binding rules closely enough for our internal SQL.
 */
export const bind = (value: unknown): LibSqlArg => {
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'string') return { type: 'text', value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'float', value };
  }
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
  if (value instanceof Uint8Array) {
    let binary = '';
    for (const byte of value) binary += String.fromCharCode(byte);
    return { type: 'blob', base64: btoa(binary) };
  }
  throw new InternalError(`Cannot bind value of type ${typeof value} to a libSQL argument`);
};

const dec = new TextDecoder();

/** Inverse of {@link bind} — convert a wire arg back to a JS value. */
export const unbind = (arg: LibSqlArg): unknown => {
  switch (arg.type) {
    case 'null':
      return null;
    case 'integer':
      return arg.value; // keep as string — JS can lose precision past 2^53
    case 'float':
      return arg.value;
    case 'text':
      return arg.value;
    case 'blob': {
      const binary = atob(arg.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return dec.decode(bytes);
    }
  }
};

/** Convert a row (array of typed args) to a `Record<column, value>` map. */
export const rowToObject = (
  cols: Array<{ name: string }>,
  row: LibSqlArg[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i];
    const cell = row[i];
    if (col && cell) out[col.name] = unbind(cell);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: string, message?: string };
    const msg = parsed.message ?? parsed.error;
    if (msg) detail = `: ${msg}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`libSQL authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`libSQL access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`libSQL not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`libSQL rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`libSQL returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`libSQL returned HTTP ${status} for ${context}${detail}`));
  }
};

const errorForStatement = (
  err: { message?: string, code?: string },
  context: string,
): InternalError | EntryAlreadyExistsError => {
  const message = err.message ?? '';
  // SQLite reports unique-constraint violations as
  // `SQLITE_CONSTRAINT_PRIMARYKEY` or `SQLITE_CONSTRAINT_UNIQUE`.
  if (/UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(message) || err.code?.startsWith('SQLITE_CONSTRAINT')) {
    return new EntryAlreadyExistsError(`libSQL unique constraint failed for ${context}: ${message}`);
  }
  return new InternalError(`libSQL statement failed for ${context}: ${message}`);
};

// ---------------------------------------------------------------------------
// Data source
// ---------------------------------------------------------------------------

/**
 * Talks the libSQL hrana HTTP pipeline protocol over `fetch`.
 *
 * Two public methods:
 *
 *  - {@link execute} — fire one statement. Internally wraps it in a
 *    one-request pipeline and unwraps the single result.
 *  - {@link batch}   — fire N statements as one atomic conditional batch.
 *    Each step's `condition` defaults to "all prior steps succeeded";
 *    if any step fails, the whole batch rolls back.
 *
 * Both go through `POST /v2/pipeline`. The wire format with typed
 * argument objects (`{type: "text", value: "..."}` etc) is unique to
 * libSQL among SQL-over-HTTP backends — Cloudflare D1's `/query`
 * uses positional `?` params alone.
 */
export class LibSqlDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: LibSqlAuth;
  private readonly baseUrl: string;

  constructor(options: LibSqlDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via LibSqlDataSourceOptions.fetch',
      );
    }
    this.auth = options.auth ?? {};
    this.baseUrl = options.url.replace(/\/+$/, '');
  }

  /** Fire one statement; return the rows + affected count. */
  async execute(
    sql: string,
    args: readonly unknown[] = [],
  ): Promise<LaikaResult<LibSqlExecuteResult>> {
    const stmt: LibSqlStatement = { sql, args: args.map(bind) };
    const result = await this.pipelineRequest([{ type: 'execute', stmt }], `execute: ${sql.slice(0, 60)}`);
    if (Result.isFailure(result)) return Result.fail(result.failure);
    const resp = result.success.results[0];
    if (!resp) return Result.fail(new InternalError('libSQL execute returned no result'));
    if (resp.type === 'error') {
      return Result.fail(errorForStatement(resp.error, sql.slice(0, 60)));
    }
    if (resp.response.type !== 'execute') {
      return Result.fail(new InternalError('libSQL execute returned non-execute response'));
    }
    return Result.succeed(resp.response.result);
  }

  /**
   * Fire N statements as one atomic `batch`. Each step's default
   * condition is "all prior steps succeeded"; one failure rolls back
   * the whole batch. Returns per-step results in order.
   *
   * This is THE atomic multi-write primitive for libSQL — one HTTP
   * round-trip, all-or-nothing semantics.
   */
  async batch(
    statements: ReadonlyArray<{ sql: string, args?: readonly unknown[] }>,
  ): Promise<LaikaResult<LibSqlExecuteResult[]>> {
    if (statements.length === 0) return Result.succeed([]);
    const steps: LibSqlBatchStep[] = statements.map((s, i) => {
      const stmt: LibSqlStatement = { sql: s.sql, args: (s.args ?? []).map(bind) };
      return i === 0
        ? { stmt }
        : { stmt, condition: { type: 'ok', step: i - 1 } };
    });
    const result = await this.pipelineRequest([{ type: 'batch', batch: { steps } }], 'batch');
    if (Result.isFailure(result)) return Result.fail(result.failure);
    const resp = result.success.results[0];
    if (!resp) return Result.fail(new InternalError('libSQL batch returned no result'));
    if (resp.type === 'error') {
      return Result.fail(errorForStatement(resp.error, 'batch'));
    }
    if (resp.response.type !== 'batch') {
      return Result.fail(new InternalError('libSQL batch returned non-batch response'));
    }
    // Batch response shape: `{step_results: [LibSqlExecuteResult | null], step_errors: [error | null]}`
    const stepResults = resp.response.result.step_results;
    const stepErrors = resp.response.result.step_errors;
    for (let i = 0; i < stepErrors.length; i += 1) {
      const e = stepErrors[i];
      if (e) return Result.fail(errorForStatement(e, `batch step ${i}`));
    }
    return Result.succeed(stepResults.filter((r): r is LibSqlExecuteResult => r !== null));
  }

  // ───────────────────────── plumbing ─────────────────────────

  private async pipelineRequest(
    requests: Array<
      | { type: 'execute', stmt: LibSqlStatement }
      | { type: 'batch', batch: { steps: LibSqlBatchStep[] } }
      | { type: 'close' }
    >,
    context: string,
  ): Promise<
    LaikaResult<{
      results: Array<
        | {
          type: 'ok',
          response: { type: 'execute', result: LibSqlExecuteResult } | {
            type: 'batch',
            result: {
              step_results: Array<LibSqlExecuteResult | null>,
              step_errors: Array<{ message?: string } | null>,
            },
          },
        }
        | { type: 'error', error: { message?: string, code?: string } }
      >,
    }>
  > {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v2/pipeline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ requests }),
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('libSQL unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), context);
    const parsed = await response.json() as {
      results: Array<
        | {
          type: 'ok',
          response: { type: 'execute', result: LibSqlExecuteResult } | {
            type: 'batch',
            result: {
              step_results: Array<LibSqlExecuteResult | null>,
              step_errors: Array<{ message?: string } | null>,
            },
          },
        }
        | { type: 'error', error: { message?: string, code?: string } }
      >,
    };
    return Result.succeed(parsed);
  }

  private async accessToken(): Promise<string | undefined> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.token;
  }
}
