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

/** Auth for Supabase's PostgREST endpoint. Both `apikey` and `Authorization: Bearer` are required. */
export interface PostgrestAuth {
  /** Anon or service role key — sent in both `apikey` and `Authorization` headers. */
  readonly anonKey?: string;
  /** Async token provider — called before every request. */
  readonly tokenProvider?: () => string | Promise<string>;
  /**
   * Optional separate Bearer token (user JWT). When provided, replaces the
   * `Authorization` header while `apikey` continues to carry `anonKey`.
   * That's how RLS-respecting user-scoped reads usually work.
   */
  readonly userJwt?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link PostgrestDataSource}. */
export interface PostgrestDataSourceOptions {
  /** PostgREST endpoint — typically `https://<project-ref>.supabase.co/rest/v1`. */
  readonly url: string;
  /** Table name (case-sensitive — must match Supabase Studio exactly). */
  readonly tableName: string;
  readonly auth: PostgrestAuth;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /** Optional schema name. Sent via `Accept-Profile` / `Content-Profile` headers. Defaults to `public`. */
  readonly schema?: string;
}

/** A row returned by PostgREST — flat field-name to value map. */
export type PostgrestRow = Record<string, unknown>;

/**
 * Encode a literal value for inclusion in a PostgREST URL filter. PostgREST
 * uses `*` as the wildcard inside `like` / `ilike` (instead of SQL `%`)
 * and treats backslash as escaping. Special characters in `in.(…)` lists
 * need their commas escaped.
 *
 * Exported for callers building their own filters.
 */
export const encodePostgrestValue = (value: string): string => encodeURIComponent(value);

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
    const parsed = JSON.parse(body) as { message?: string, hint?: string };
    if (parsed.message) detail = `: ${parsed.message}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`PostgREST authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`PostgREST access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`PostgREST resource not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`PostgREST rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`PostgREST service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`PostgREST returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`PostgREST returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [PostgREST API](https://docs.postgrest.org/en/stable/) over
 * `fetch`. Supabase exposes PostgREST automatically on every project, so
 * this is the same data source that hits a self-hosted PostgREST instance —
 * the only Supabase-specific knob is the `apikey` header.
 *
 * PostgREST's query DSL is the interesting bit — operator-suffix filters
 * tacked onto URL query parameters:
 *
 *     ?Parent=eq.notes                          column equals
 *     ?Path=in.("a","b","c")                    column IN (list)
 *     ?or=(Name.eq.a.md,Name.eq.a.json)         logical OR
 *     ?Path=eq.foo&Type=eq.folder               implicit AND
 *
 * Every filter shape this data source emits is built here; consumers
 * supply field name + operator + value tuples and the data source
 * URL-encodes them correctly. PostgREST is strict about formatting —
 * values containing commas, dots, or parens inside `in.()` and `or=()`
 * have to be double-quoted, and we handle that.
 */
export class PostgrestDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: PostgrestAuth;
  private readonly url: string;
  private readonly tableName: string;
  private readonly schema: string;

  constructor(options: PostgrestDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via PostgrestDataSourceOptions.fetch');
    }
    if (!options.auth.anonKey && !options.auth.tokenProvider) {
      throw new InternalError('PostgrestDataSource requires `auth.anonKey` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.url = options.url.replace(/\/+$/, '');
    this.tableName = options.tableName;
    this.schema = options.schema ?? 'public';
  }

  private tableUrl(): string {
    return `${this.url}/${encodeURIComponent(this.tableName)}`;
  }

  private async apikey(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.anonKey as string;
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: unknown, headers?: Record<string, string> },
  ): Promise<Response> {
    const apikey = await this.apikey();
    const bearer = this.auth.userJwt ?? apikey;
    const headers: Record<string, string> = {
      apikey,
      Authorization: `Bearer ${bearer}`,
      'Accept-Profile': this.schema,
      'Content-Profile': this.schema,
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(this.auth.headers ?? {}),
      ...(init?.headers ?? {}),
    };
    return this.fetchImpl(url, {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  }

  /**
   * Run a SELECT against the configured table. `filters` is a list of
   * `{column, operator, value}` triples that get joined into PostgREST's
   * URL form. Optional `or` clause is composed verbatim into `or=(…)`.
   */
  async list<F extends PostgrestRow = PostgrestRow>(
    filters: Array<
      { column: string, operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in', value: string }
    >,
    options: { or?: string, limit?: number, order?: string } = {},
  ): Promise<LaikaResult<F[]>> {
    const url = new URL(this.tableUrl());
    for (const f of filters) {
      url.searchParams.append(f.column, `${f.operator}.${f.value}`);
    }
    if (options.or) url.searchParams.append('or', `(${options.or})`);
    if (options.limit !== undefined) url.searchParams.append('limit', String(options.limit));
    if (options.order) url.searchParams.append('order', options.order);

    let response: Response;
    try {
      response = await this.request('GET', url.toString());
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('PostgREST unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'list');
    return Result.succeed((await response.json()) as F[]);
  }

  /** Insert one or more rows. Returns the inserted rows when `Prefer: return=representation` is set. */
  async insert<F extends PostgrestRow>(rows: ReadonlyArray<F>): Promise<LaikaResult<F[]>> {
    let response: Response;
    try {
      response = await this.request('POST', this.tableUrl(), {
        body: rows,
        headers: { Prefer: 'return=representation' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('PostgREST unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'insert');
    return Result.succeed((await response.json()) as F[]);
  }

  /**
   * Patch rows matching `filters`. Returns the updated rows when
   * `Prefer: return=representation` is set.
   */
  async update<F extends PostgrestRow>(
    filters: Array<{ column: string, operator: 'eq' | 'in', value: string }>,
    patch: Partial<F>,
  ): Promise<LaikaResult<F[]>> {
    const url = new URL(this.tableUrl());
    for (const f of filters) {
      url.searchParams.append(f.column, `${f.operator}.${f.value}`);
    }
    let response: Response;
    try {
      response = await this.request('PATCH', url.toString(), {
        body: patch,
        headers: { Prefer: 'return=representation' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('PostgREST unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'update');
    return Result.succeed((await response.json()) as F[]);
  }

  /** Delete rows matching `filters`. Returns the deleted rows when `Prefer: return=representation` is set. */
  async delete<F extends PostgrestRow>(
    filters: Array<{ column: string, operator: 'eq' | 'in', value: string }>,
  ): Promise<LaikaResult<F[]>> {
    const url = new URL(this.tableUrl());
    for (const f of filters) {
      url.searchParams.append(f.column, `${f.operator}.${f.value}`);
    }
    let response: Response;
    try {
      response = await this.request('DELETE', url.toString(), {
        headers: { Prefer: 'return=representation' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('PostgREST unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'delete');
    return Result.succeed((await response.json()) as F[]);
  }
}
