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

/** Default collection name. Override via `collectionName` for multi-tenant deployments. */
export const DEFAULT_COLLECTION_NAME = 'laika_storage';

/** Auth for the PocketBase REST API. */
export interface PocketBaseAuth {
  /** Static JWT (e.g. from `POST /api/admins/auth-with-password`). */
  readonly token?: string;
  /** Async token provider — called before every request so refreshes are transparent. */
  readonly tokenProvider?: () => string | Promise<string>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link PocketBaseDataSource}. */
export interface PocketBaseDataSourceOptions {
  /** Base URL of the PocketBase deployment, e.g. `https://pb.example.com`. */
  readonly url: string;
  readonly auth: PocketBaseAuth;
  /** Collection name. Defaults to `laika_storage`. */
  readonly collectionName?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Common shape of every PocketBase record. */
export interface PocketBaseRecord {
  readonly id: string;
  readonly collectionId?: string;
  readonly collectionName?: string;
  readonly created?: string;
  readonly updated?: string;
  readonly [field: string]: unknown;
}

/**
 * Escape a literal value for use inside a PocketBase filter string. The PB
 * filter mini-language wraps strings in double quotes; we escape backslashes
 * and double-quotes inside the value.
 */
export const escapePbFilterValue = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) detail = `: ${parsed.message}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`PocketBase authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`PocketBase access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`PocketBase record not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`PocketBase rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`PocketBase service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`PocketBase returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`PocketBase returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [PocketBase REST API](https://pocketbase.io/docs/api-records/)
 * over `fetch`. Three concerns this datasource handles for the repository:
 *
 * 1. **Filter syntax.** PocketBase's filter mini-language uses `=`, `!=`,
 *    `&&`, `||`, and double-quoted literals — different from GROQ, SQL,
 *    Algolia's filter syntax, and every other backend in the suite. The
 *    {@link escapePbFilterValue} helper handles quoting.
 * 2. **Pagination.** Every list call returns `{items, page, perPage,
 *    totalPages, totalItems}` — the datasource drains all pages so
 *    callers see a complete list.
 * 3. **JWT auth.** Bearer-style header, statically configurable or
 *    refreshed via `tokenProvider`. PocketBase tokens are typically
 *    short-lived; supplying a provider is the right move for long-running
 *    repositories.
 */
export class PocketBaseDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: PocketBaseAuth;
  private readonly url: string;
  readonly collectionName: string;

  constructor(options: PocketBaseDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via PocketBaseDataSourceOptions.fetch');
    }
    if (!options.auth.token && !options.auth.tokenProvider) {
      throw new InternalError('PocketBaseDataSource requires `auth.token` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.url = options.url.replace(/\/+$/, '');
    this.collectionName = options.collectionName ?? DEFAULT_COLLECTION_NAME;
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.token as string;
  }

  private collectionPath(): string {
    return `${this.url}/api/collections/${encodeURIComponent(this.collectionName)}/records`;
  }

  private async request(method: string, url: string, body?: unknown): Promise<Response> {
    const token = await this.accessToken();
    return this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(this.auth.headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * List records matching `filter`. Drains every page. Returns an empty
   * array when nothing matches.
   */
  async list(filter: string, options: { sort?: string; perPage?: number } = {}): Promise<LaikaResult<PocketBaseRecord[]>> {
    const all: PocketBaseRecord[] = [];
    let page = 1;
    const perPage = options.perPage ?? 500;
    while (true) {
      const url = new URL(this.collectionPath());
      url.searchParams.set('filter', filter);
      url.searchParams.set('page', String(page));
      url.searchParams.set('perPage', String(perPage));
      if (options.sort) url.searchParams.set('sort', options.sort);

      let response: Response;
      try {
        response = await this.request('GET', url.toString());
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('PocketBase unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), 'list');
      const data = (await response.json()) as {
        items: PocketBaseRecord[];
        page: number;
        perPage: number;
        totalPages: number;
        totalItems: number;
      };
      all.push(...data.items);
      if (data.page >= data.totalPages || data.items.length === 0) break;
      page += 1;
    }
    return Result.succeed(all);
  }

  /** Convenience — single-record fetch by filter. Returns `null` on no match. */
  async findOne(filter: string): Promise<LaikaResult<PocketBaseRecord | null>> {
    const url = new URL(this.collectionPath());
    url.searchParams.set('filter', filter);
    url.searchParams.set('page', '1');
    url.searchParams.set('perPage', '1');
    let response: Response;
    try {
      response = await this.request('GET', url.toString());
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('PocketBase unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'findOne');
    const data = (await response.json()) as { items: PocketBaseRecord[] };
    return Result.succeed(data.items[0] ?? null);
  }

  /** Create a new record. PocketBase auto-assigns the `id`. */
  async create(fields: Record<string, unknown>): Promise<LaikaResult<PocketBaseRecord>> {
    let response: Response;
    try {
      response = await this.request('POST', this.collectionPath(), fields);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('PocketBase unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'create');
    return Result.succeed((await response.json()) as PocketBaseRecord);
  }

  /** Patch an existing record by id. */
  async patch(id: string, fields: Record<string, unknown>): Promise<LaikaResult<PocketBaseRecord>> {
    let response: Response;
    try {
      response = await this.request('PATCH', `${this.collectionPath()}/${encodeURIComponent(id)}`, fields);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('PocketBase unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), id);
    return Result.succeed((await response.json()) as PocketBaseRecord);
  }

  /** Delete a record by id. A 404 is treated as success — the caller wanted it gone. */
  async delete(id: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('DELETE', `${this.collectionPath()}/${encodeURIComponent(id)}`);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('PocketBase unreachable', { cause }));
    }
    if (response.ok || response.status === 404) return Result.succeed(undefined);
    return errorForResponse(response.status, await safeText(response), id);
  }
}
