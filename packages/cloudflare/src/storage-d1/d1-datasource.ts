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

const DEFAULT_API_URL = 'https://api.cloudflare.com/client/v4';

/** Auth for the Cloudflare D1 REST API. */
export interface D1Auth {
  /** Bearer API token. Sent as `Authorization: Bearer …`. */
  readonly apiToken?: string;
  /** Async token provider — called before every request so refreshes are transparent. */
  readonly tokenProvider?: () => string | Promise<string>;
  /** Extra headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link D1DataSource}. */
export interface D1DataSourceOptions {
  readonly auth: D1Auth;
  /** Cloudflare account id (visible in the dashboard URL). */
  readonly accountId: string;
  /** D1 database id (UUID). */
  readonly databaseId: string;
  /** Override the API base URL. Defaults to `https://api.cloudflare.com/client/v4`. */
  readonly apiUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** A single row from a D1 query — flat shape, column → value. */
export type D1Row = Record<string, unknown>;

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ message?: string }> };
    if (parsed.errors?.length) detail = `: ${parsed.errors.map(e => e.message).filter(Boolean).join('; ')}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Cloudflare D1 authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Cloudflare D1 access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Cloudflare D1 resource not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Cloudflare D1 rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Cloudflare D1 service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Cloudflare D1 returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Cloudflare D1 returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [Cloudflare D1 REST API](https://developers.cloudflare.com/d1/platform/client-api/)
 * over `fetch`. The API endpoint accepts a SQL string + positional parameter
 * array and returns a JSON envelope: `{success, result: [{results, success,
 * meta}]}`. This datasource normalizes that surface into two methods:
 *
 * - `query(sql, params)` — returns the rows.
 * - `execute(sql, params)` — returns `{rowsAffected}`. Use for `INSERT` /
 *   `UPDATE` / `DELETE` / `CREATE TABLE`.
 *
 * Errors are mapped onto the Laika error hierarchy. Cloudflare returns
 * `success: false` with details inside `errors[]` for SQL-level problems —
 * those land as `InternalError` so callers can inspect the underlying cause.
 */
export class D1DataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: D1Auth;
  private readonly apiUrl: string;
  private readonly accountId: string;
  private readonly databaseId: string;

  constructor(options: D1DataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via D1DataSourceOptions.fetch');
    }
    if (!options.auth.apiToken && !options.auth.tokenProvider) {
      throw new InternalError('D1DataSource requires `auth.apiToken` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.accountId = options.accountId;
    this.databaseId = options.databaseId;
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.apiToken as string;
  }

  private endpointUrl(): string {
    return `${this.apiUrl}/accounts/${encodeURIComponent(this.accountId)}/d1/database/${encodeURIComponent(this.databaseId)}/query`;
  }

  private async request(sql: string, params: ReadonlyArray<unknown>): Promise<LaikaResult<{
    results: D1Row[];
    rowsAffected: number;
  }>> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpointUrl(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(this.auth.headers ?? {}),
        },
        body: JSON.stringify({ sql, params }),
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Cloudflare D1 unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), sql.slice(0, 80));

    const data = (await response.json()) as {
      success: boolean;
      errors?: Array<{ message?: string }>;
      result?: Array<{
        success?: boolean;
        results?: D1Row[];
        meta?: { rows_written?: number; changes?: number };
      }>;
    };
    if (!data.success) {
      const message = data.errors?.map(e => e.message).filter(Boolean).join('; ') ?? 'unknown D1 error';
      return Result.fail(new InternalError(`Cloudflare D1 query failed: ${message}`));
    }
    const first = data.result?.[0];
    return Result.succeed({
      results: first?.results ?? [],
      rowsAffected: first?.meta?.changes ?? first?.meta?.rows_written ?? 0,
    });
  }

  /** Run a query and return the rows. */
  async query<T extends D1Row = D1Row>(sql: string, params: ReadonlyArray<unknown> = []): Promise<LaikaResult<T[]>> {
    const out = await this.request(sql, params);
    if (Result.isFailure(out)) return Result.fail(out.failure);
    return Result.succeed(out.success.results as T[]);
  }

  /** Run a statement and return the number of rows changed. */
  async execute(sql: string, params: ReadonlyArray<unknown> = []): Promise<LaikaResult<{ rowsAffected: number }>> {
    const out = await this.request(sql, params);
    if (Result.isFailure(out)) return Result.fail(out.failure);
    return Result.succeed({ rowsAffected: out.success.rowsAffected });
  }
}
