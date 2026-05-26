import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  ConflictError,
  EntryAlreadyExistsError,
  ForbiddenError,
  InternalError,
  InvalidData,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  VersionMismatchError,
} from 'laikacms/core';

/** Auth for the Contentful Management API (CMA). A Personal Access Token is the simplest source. */
export interface ContentfulAuth {
  /** CMA access token, sent as `Authorization: Bearer …`. */
  readonly accessToken?: string;
  /** Async access-token provider; called before every request so refreshes are transparent. */
  readonly tokenProvider?: () => string | Promise<string>;
  /** Extra headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link ContentfulDataSource}. */
export interface ContentfulDataSourceOptions {
  readonly spaceId: string;
  /** Environment id; defaults to `master`. */
  readonly environmentId?: string;
  readonly auth: ContentfulAuth;
  /** Default locale (e.g. `en-US`). Used as the locale key when reading/writing field values. */
  readonly defaultLocale?: string;
  /** Base URL of the CMA. Defaults to `https://api.contentful.com`. */
  readonly apiUrl?: string;
  /** Custom `fetch` — handy for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Contentful entry as returned by the CMA. */
export interface ContentfulEntry {
  readonly sys: {
    readonly id: string,
    readonly type: 'Entry',
    readonly version: number,
    readonly contentType: { readonly sys: { readonly id: string } },
    readonly createdAt?: string,
    readonly updatedAt?: string,
    readonly publishedVersion?: number,
  };
  readonly fields: Record<string, Record<string, unknown>>;
}

/** Contentful content type ("schema") as returned by the CMA. */
export interface ContentfulContentType {
  readonly sys: {
    readonly id: string,
    readonly type: 'ContentType',
    readonly version: number,
    readonly publishedVersion?: number,
    readonly createdAt?: string,
    readonly updatedAt?: string,
  };
  readonly name: string;
  readonly description?: string;
  readonly displayField?: string;
  readonly fields: Array<{
    readonly id: string,
    readonly name: string,
    readonly type: string,
    readonly required?: boolean,
    readonly localized?: boolean,
  }>;
}

const DEFAULT_API_URL = 'https://api.contentful.com';
const DEFAULT_ENV = 'master';
const DEFAULT_LOCALE = 'en-US';

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

/** Map a Contentful HTTP status to a Laika error, surfacing the JSON `message` field when possible. */
const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let message = '';
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) message = `: ${parsed.message}`;
  } catch { /* body wasn't JSON; ignore */ }

  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Contentful authentication failed for ${context}${message}`));
    case 403:
      return Result.fail(new ForbiddenError(`Contentful access denied for ${context}${message}`));
    case 404:
      return Result.fail(new NotFoundError(`Contentful resource not found: ${context}${message}`));
    case 409:
      return Result.fail(new VersionMismatchError(`Contentful version mismatch for ${context}${message}`));
    case 422:
      return Result.fail(new InvalidData(`Contentful rejected ${context}${message}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Contentful rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Contentful service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Contentful returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Contentful returned HTTP ${status} for ${context}${message}`));
  }
};

/**
 * Talks the [Contentful Management API](https://www.contentful.com/developers/docs/references/content-management-api/)
 * over `fetch`. Stateless aside from the caller-supplied token; auth refresh
 * is the caller's responsibility (via `tokenProvider`).
 *
 * The datasource intentionally exposes Contentful's own concepts —
 * content types, entries, the `sys.version` counter — rather than trying
 * to flatten them. The repository above maps them onto the storage shape.
 */
export class ContentfulDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: ContentfulAuth;
  private readonly apiUrl: string;
  private readonly spaceId: string;
  private readonly environmentId: string;
  /** Exposed so the repository can write field values under the same locale it reads. */
  readonly defaultLocale: string;

  constructor(options: ContentfulDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via ContentfulDataSourceOptions.fetch',
      );
    }
    if (!options.auth.accessToken && !options.auth.tokenProvider) {
      throw new InternalError('ContentfulDataSource requires `auth.accessToken` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.spaceId = options.spaceId;
    this.environmentId = options.environmentId ?? DEFAULT_ENV;
    this.defaultLocale = options.defaultLocale ?? DEFAULT_LOCALE;
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.accessToken as string;
  }

  private envPath(rest: string): string {
    return `${this.apiUrl}/spaces/${encodeURIComponent(this.spaceId)}/environments/${
      encodeURIComponent(this.environmentId)
    }${rest}`;
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: unknown, headers?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.contentful.management.v1+json',
      ...(this.auth.headers ?? {}),
      ...(init?.headers ?? {}),
    };
    return this.fetchImpl(url, {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  }

  // -----------------------------------------------------------------------
  // Content types ("schemas") — mapped to folders by the repository.
  // -----------------------------------------------------------------------

  /** Get a content type by id. Returns `null` for `404`. */
  async getContentType(id: string): Promise<LaikaResult<ContentfulContentType | null>> {
    let response: Response;
    try {
      response = await this.request('GET', this.envPath(`/content_types/${encodeURIComponent(id)}`));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Contentful unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), id);
    return Result.succeed((await response.json()) as ContentfulContentType);
  }

  /** List every content type in the environment, paging through `skip` until exhausted. */
  async listContentTypes(): Promise<LaikaResult<ContentfulContentType[]>> {
    const all: ContentfulContentType[] = [];
    let skip = 0;
    const limit = 1000;
    while (true) {
      let response: Response;
      try {
        response = await this.request(
          'GET',
          this.envPath(`/content_types?skip=${skip}&limit=${limit}`),
        );
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Contentful unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), '<content_types>');
      const page = (await response.json()) as { items: ContentfulContentType[], total: number };
      all.push(...page.items);
      skip += page.items.length;
      if (page.items.length < limit || skip >= page.total) break;
    }
    return Result.succeed(all);
  }

  /**
   * Idempotently create and activate a content type. If one with `id` already
   * exists this is a no-op that returns the existing (activated) content type.
   * Default schema: one `body` Text field — overrideable via `fields`.
   */
  async ensureContentType(
    id: string,
    fields?: ContentfulContentType['fields'],
  ): Promise<LaikaResult<ContentfulContentType>> {
    const existing = await this.getContentType(id);
    if (Result.isFailure(existing)) return Result.fail(existing.failure);
    if (existing.success) return Result.succeed(existing.success);

    const payload = {
      name: id,
      fields: fields ?? [{ id: 'body', name: 'Body', type: 'Text', required: false, localized: false }],
    };
    let response: Response;
    try {
      response = await this.request('PUT', this.envPath(`/content_types/${encodeURIComponent(id)}`), {
        body: payload,
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Contentful unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), id);
    const created = (await response.json()) as ContentfulContentType;
    return this.activateContentType(created);
  }

  /** Activate a content type so new entries can reference it. */
  private async activateContentType(
    ct: ContentfulContentType,
  ): Promise<LaikaResult<ContentfulContentType>> {
    let response: Response;
    try {
      response = await this.request(
        'PUT',
        this.envPath(`/content_types/${encodeURIComponent(ct.sys.id)}/published`),
        { headers: { 'X-Contentful-Version': String(ct.sys.version) } },
      );
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Contentful unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), ct.sys.id);
    return Result.succeed((await response.json()) as ContentfulContentType);
  }

  // -----------------------------------------------------------------------
  // Entries — mapped to objects by the repository.
  // -----------------------------------------------------------------------

  /** Get a single entry by id. Returns `null` for `404`. */
  async getEntry(id: string): Promise<LaikaResult<ContentfulEntry | null>> {
    let response: Response;
    try {
      response = await this.request('GET', this.envPath(`/entries/${encodeURIComponent(id)}`));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Contentful unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), id);
    return Result.succeed((await response.json()) as ContentfulEntry);
  }

  /** List entries of a content type, paging until exhausted. */
  async listEntries(contentTypeId: string): Promise<LaikaResult<ContentfulEntry[]>> {
    const all: ContentfulEntry[] = [];
    let skip = 0;
    const limit = 1000;
    while (true) {
      let response: Response;
      try {
        response = await this.request(
          'GET',
          this.envPath(
            `/entries?content_type=${encodeURIComponent(contentTypeId)}&skip=${skip}&limit=${limit}`,
          ),
        );
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Contentful unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), contentTypeId);
      const page = (await response.json()) as { items: ContentfulEntry[], total: number };
      all.push(...page.items);
      skip += page.items.length;
      if (page.items.length < limit || skip >= page.total) break;
    }
    return Result.succeed(all);
  }

  /**
   * Create an entry with a caller-supplied id. Maps a `422` "id already exists"
   * onto {@link EntryAlreadyExistsError} so the repository can surface a
   * meaningful duplicate-create error.
   */
  async createEntry(
    id: string,
    contentTypeId: string,
    fields: ContentfulEntry['fields'],
  ): Promise<LaikaResult<ContentfulEntry>> {
    let response: Response;
    try {
      response = await this.request('PUT', this.envPath(`/entries/${encodeURIComponent(id)}`), {
        body: { fields },
        headers: { 'X-Contentful-Content-Type': contentTypeId },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Contentful unreachable', { cause }));
    }
    if (response.status === 409) {
      return Result.fail(
        new EntryAlreadyExistsError(`Contentful entry "${contentTypeId}/${id}" already exists`),
      );
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), id);
    return Result.succeed((await response.json()) as ContentfulEntry);
  }

  /** Update an entry, sending `X-Contentful-Version` so Contentful enforces OCC. */
  async updateEntry(
    id: string,
    version: number,
    fields: ContentfulEntry['fields'],
  ): Promise<LaikaResult<ContentfulEntry>> {
    let response: Response;
    try {
      response = await this.request('PUT', this.envPath(`/entries/${encodeURIComponent(id)}`), {
        body: { fields },
        headers: { 'X-Contentful-Version': String(version) },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Contentful unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), id);
    return Result.succeed((await response.json()) as ContentfulEntry);
  }

  /** Delete an entry. `version` enforces OCC. */
  async deleteEntry(id: string, version: number): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('DELETE', this.envPath(`/entries/${encodeURIComponent(id)}`), {
        headers: { 'X-Contentful-Version': String(version) },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Contentful unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(undefined);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), id);
    return Result.succeed(undefined);
  }

  /** Unsupported leaf — flagged for callers who try to write outside the content-type model. */
  notSupportedAtRoot(action: string): ConflictError {
    return new ConflictError(`Contentful does not support ${action} at the storage root`);
  }
}
