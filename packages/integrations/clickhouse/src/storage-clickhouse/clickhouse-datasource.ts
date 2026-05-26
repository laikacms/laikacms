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
// ClickHouse HTTP data source
// ---------------------------------------------------------------------------
//
// ClickHouse is a columnar OLAP database designed for high-throughput
// reads against append-mostly tables. Four traits set the wire shape
// apart from every prior backend in the Laika suite:
//
//   1. **Streaming NDJSON wire format.** Requesting `FORMAT JSONEachRow`
//      returns the result set as newline-delimited JSON — one row per
//      line, parseable incrementally. INSERTs accept the same format in
//      the request body: `INSERT ... FORMAT JSONEachRow\n{...}\n{...}\n`.
//      First backend in the suite with streaming row-at-a-time wire
//      format. The {@link parseNdjson} / {@link serializeNdjson} helpers
//      handle the boundary.
//
//   2. **URL-as-query.** SQL travels in the request URL as
//      `?query=<urlencoded SQL>`, not the body. The body is reserved
//      for INSERT data. The "split" is structural — the same HTTP
//      request can carry both a SQL query in the URL and inline NDJSON
//      data in the body. First backend in the suite where SQL and
//      payload live in different parts of the wire envelope.
//
//   3. **`ReplacingMergeTree(version)` upsert semantics.** Schemas
//      using this engine deduplicate rows on background merges, keeping
//      the row with the highest version per (ORDER BY) key. Writes are
//      effectively idempotent upserts — re-inserting the same path
//      with a newer version takes precedence on read with `FINAL`.
//
//   4. **`X-ClickHouse-*` header conventions.** Auth via
//      `X-ClickHouse-User` / `X-ClickHouse-Key` headers (rather than
//      `Authorization: Basic ...`, though that's accepted too).
//      Format negotiation via `X-ClickHouse-Format`.

const DEFAULT_API_URL = 'http://localhost:8123';
const DEFAULT_DATABASE = 'default';

export interface ClickHouseAuth {
  /** HTTP Basic credentials — `Authorization: Basic …`. */
  readonly basic?: { username: string, password: string };
  /**
   * `X-ClickHouse-User` / `X-ClickHouse-Key` header pair — preferred by
   * ClickHouse Cloud / production deployments.
   */
  readonly headers?: { username: string, password: string };
  /** Async hook — overrides the static auth fields. */
  readonly headerProvider?: () => Record<string, string> | Promise<Record<string, string>>;
}

export interface ClickHouseDataSourceOptions {
  readonly auth?: ClickHouseAuth;
  /** Base URL — `http://host:8123` or `https://...clickhouse.cloud:8443`. */
  readonly url?: string;
  /** Database name; default `default`. */
  readonly database?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  const detail = body ? `: ${body.slice(0, 200)}` : '';
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`ClickHouse authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`ClickHouse access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`ClickHouse endpoint not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`ClickHouse rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`ClickHouse returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`ClickHouse returned HTTP ${status} for ${context}${detail}`));
  }
};

// ---------------------------------------------------------------------------
// NDJSON helpers (the load-bearing wire-format adapters)
// ---------------------------------------------------------------------------

/**
 * Parse a newline-delimited JSON response into an array of rows. Tolerates
 * trailing newlines and empty lines.
 */
export const parseNdjson = <T = unknown>(text: string): T[] => {
  const rows: T[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      const line = text.slice(start, i).trim();
      if (line.length > 0) rows.push(JSON.parse(line) as T);
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) rows.push(JSON.parse(tail) as T);
  return rows;
};

/** Serialize an array of objects to newline-delimited JSON. */
export const serializeNdjson = (rows: ReadonlyArray<Record<string, unknown>>): string =>
  rows.map(r => JSON.stringify(r)).join('\n');

// ---------------------------------------------------------------------------
// Data source
// ---------------------------------------------------------------------------

/**
 * Talks the ClickHouse HTTP API over `fetch`. Two primary methods:
 *
 *  - {@link query} — fire a SELECT (or DDL) statement; SQL goes in the
 *    `?query=` URL parameter, response comes back as NDJSON parsed
 *    into a JS array.
 *
 *  - {@link insertRows} — bulk-insert N rows in one HTTP request. SQL
 *    goes in `?query=INSERT INTO table FORMAT JSONEachRow`, body is
 *    the NDJSON payload. The split is intrinsic to ClickHouse's wire
 *    protocol — no other backend in the suite uses both URL and body
 *    for one statement.
 *
 * Both default to the `JSONEachRow` format. The `?database=…` query
 * parameter sets the active database for the statement.
 */
export class ClickHouseDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: ClickHouseAuth;
  private readonly apiUrl: string;
  readonly database: string;

  constructor(options: ClickHouseDataSourceOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via ClickHouseDataSourceOptions.fetch',
      );
    }
    this.auth = options.auth ?? {};
    this.apiUrl = (options.url ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.database = options.database ?? DEFAULT_DATABASE;
  }

  /**
   * Fire a SELECT or DDL statement. Result format defaults to
   * `JSONEachRow` — returned rows are parsed via {@link parseNdjson}.
   *
   * Pass `params` to use ClickHouse's parameterised-query syntax
   * (`{paramName:Type}` placeholders). Each parameter is passed as a
   * `param_<name>=<value>` URL query parameter — the value is
   * URL-encoded but otherwise left raw. ClickHouse coerces based on
   * the `Type` annotation in the SQL.
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: Record<string, unknown> = {},
  ): Promise<LaikaResult<T[]>> {
    // Default ClickHouse SELECT returns TabSeparated; we always want NDJSON.
    const sqlWithFormat = /\bFORMAT\b/i.test(sql) ? sql : `${sql} FORMAT JSONEachRow`;
    const url = this.buildUrl(sqlWithFormat, params);
    let response: Response;
    try {
      response = await this.request('POST', url, '');
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('ClickHouse unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), sql.slice(0, 60));
    const body = await response.text();
    try {
      return Result.succeed(parseNdjson<T>(body));
    } catch (cause) {
      return Result.fail(
        new InternalError(
          `Failed to parse ClickHouse NDJSON response: ${(cause as Error).message}`,
          { cause },
        ),
      );
    }
  }

  /**
   * Bulk-insert N rows. The SQL `INSERT INTO table FORMAT JSONEachRow`
   * goes in the URL; the rows go in the body as NDJSON. **THIS is the
   * load-bearing wire shape** — the URL/body split is intrinsic to
   * ClickHouse and unique among the suite.
   */
  async insertRows(
    table: string,
    rows: ReadonlyArray<Record<string, unknown>>,
  ): Promise<LaikaResult<void>> {
    if (rows.length === 0) return Result.succeed(undefined);
    const sql = `INSERT INTO ${table} FORMAT JSONEachRow`;
    const url = this.buildUrl(sql, {});
    const body = serializeNdjson(rows);
    let response: Response;
    try {
      response = await this.request('POST', url, body);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('ClickHouse unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), table);
    return Result.succeed(undefined);
  }

  /** Fire a DELETE / ALTER / DDL statement that doesn't return rows. */
  async exec(sql: string, params: Record<string, unknown> = {}): Promise<LaikaResult<void>> {
    const url = this.buildUrl(sql, params);
    let response: Response;
    try {
      response = await this.request('POST', url, '');
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('ClickHouse unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), sql.slice(0, 60));
    return Result.succeed(undefined);
  }

  // ───────────────────────── plumbing ─────────────────────────

  private buildUrl(sql: string, params: Record<string, unknown>): string {
    const url = new URL(this.apiUrl + '/');
    url.searchParams.set('database', this.database);
    url.searchParams.set('query', sql);
    // ClickHouse parameterised queries — `{name:Type}` placeholders in SQL
    // expect `param_<name>=<value>` URL params. The Type annotation lives
    // in the SQL itself, not the parameter binding.
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(
        `param_${name}`,
        value === null || value === undefined ? '\\N' : String(value),
      );
    }
    return url.toString();
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.auth.headerProvider) return await this.auth.headerProvider();
    const out: Record<string, string> = {};
    if (this.auth.basic) {
      const { username, password } = this.auth.basic;
      out['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
    }
    if (this.auth.headers) {
      out['X-ClickHouse-User'] = this.auth.headers.username;
      out['X-ClickHouse-Key'] = this.auth.headers.password;
    }
    return out;
  }

  private async request(method: string, url: string, body: string): Promise<Response> {
    const auth = await this.authHeaders();
    return this.fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/x-ndjson, application/json, */*',
        'Content-Type': 'application/x-ndjson',
        ...auth,
      },
      body,
    });
  }
}
