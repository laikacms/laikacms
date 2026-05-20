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

/** Auth for the Algolia REST API. */
export interface AlgoliaAuth {
  /** Algolia Application ID. */
  readonly applicationId: string;
  /** API key. Use an admin/write key for read+write; use a search-only key for read-only repositories. */
  readonly apiKey: string;
  /** Extra headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for an {@link AlgoliaDataSource}. */
export interface AlgoliaDataSourceOptions {
  readonly auth: AlgoliaAuth;
  readonly indexName: string;
  /** Override the API base URL (defaults to `https://<applicationId>-dsn.algolia.net`). */
  readonly apiUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

// --- Reserved attributes on every record this repository writes -----------
// Underscore-prefixed names keep them out of the user's content namespace.
export const TYPE_ATTR = '_type';
export const PARENT_ATTR = '_parent';
export const EXTENSION_ATTR = '_extension';
export const CONTENT_ATTR = '_content';

/** Shape of a record as written to and read from Algolia. */
export interface AlgoliaRecord {
  readonly objectID: string;
  readonly [TYPE_ATTR]: 'file' | 'folder';
  readonly [PARENT_ATTR]: string;
  readonly [EXTENSION_ATTR]?: string;
  /**
   * Serialized object content. Stored as a top-level attribute so it lands in
   * Algolia's inverted index alongside the record metadata.
   */
  readonly [CONTENT_ATTR]?: string;
  readonly _createdAt?: string;
  readonly _updatedAt?: string;
  readonly [key: string]: unknown;
}

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  const detail = body && body.length > 0 ? `: ${body.slice(0, 200)}` : '';
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Algolia authentication failed for ${context}`));
    case 403:
      return Result.fail(new ForbiddenError(`Algolia access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Algolia resource not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Algolia rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Algolia service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Algolia returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Algolia returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [Algolia REST API](https://www.algolia.com/doc/rest-api/search/) over
 * `fetch`. Stateless; the application id + API key are sent in two headers
 * on every request.
 *
 * The datasource speaks Algolia's record/index vocabulary directly — the
 * repository above maps Laika storage keys onto it.
 */
export class AlgoliaDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;
  private readonly indexName: string;
  private readonly headers: Readonly<Record<string, string>>;

  constructor(options: AlgoliaDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via AlgoliaDataSourceOptions.fetch');
    }
    this.apiUrl = (options.apiUrl ?? `https://${options.auth.applicationId}-dsn.algolia.net`).replace(/\/+$/, '');
    this.indexName = options.indexName;
    this.headers = {
      'X-Algolia-Application-Id': options.auth.applicationId,
      'X-Algolia-API-Key': options.auth.apiKey,
      'Content-Type': 'application/json',
      ...(options.auth.headers ?? {}),
    };
  }

  /** Index name exposed for diagnostics. */
  get index(): string {
    return this.indexName;
  }

  private indexPath(rest: string): string {
    return `${this.apiUrl}/1/indexes/${encodeURIComponent(this.indexName)}${rest}`;
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: unknown },
  ): Promise<Response> {
    return this.fetchImpl(url, {
      method,
      headers: this.headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  }

  /** GET a record by `objectID`. `null` on 404. */
  async getRecord(objectID: string): Promise<LaikaResult<AlgoliaRecord | null>> {
    let response: Response;
    try {
      response = await this.request('GET', this.indexPath(`/${encodeURIComponent(objectID)}`));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Algolia unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), objectID);
    return Result.succeed((await response.json()) as AlgoliaRecord);
  }

  /**
   * PUT a single record. Algolia writes are upserts — the same call creates
   * or replaces. Returns the server-assigned `objectID`.
   */
  async putRecord(record: AlgoliaRecord): Promise<LaikaResult<{ objectID: string; taskID?: number }>> {
    let response: Response;
    try {
      response = await this.request('PUT', this.indexPath(`/${encodeURIComponent(record.objectID)}`), {
        body: record,
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Algolia unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), record.objectID);
    const out = (await response.json()) as { objectID: string; taskID?: number };
    return Result.succeed(out);
  }

  /** DELETE a record. 404 is treated as success — the caller wanted it gone. */
  async deleteRecord(objectID: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('DELETE', this.indexPath(`/${encodeURIComponent(objectID)}`));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Algolia unreachable', { cause }));
    }
    if (response.ok || response.status === 404) return Result.succeed(undefined);
    return errorForResponse(response.status, await safeText(response), objectID);
  }

  /**
   * Query the index for records whose `_parent` attribute matches `parent`.
   * Pages through Algolia's `page`/`nbPages` cursor.
   */
  async queryByParent(parent: string): Promise<LaikaResult<AlgoliaRecord[]>> {
    const all: AlgoliaRecord[] = [];
    let page = 0;
    while (true) {
      let response: Response;
      try {
        // Algolia's query API expects `filters` (a string) and `hitsPerPage`/`page`.
        // The double-quote escaping protects against `parent` values with reserved chars.
        const filters = `${PARENT_ATTR}:${JSON.stringify(parent)}`;
        const params = new URLSearchParams();
        params.set('filters', filters);
        params.set('hitsPerPage', '1000');
        params.set('page', String(page));
        response = await this.request('POST', this.indexPath('/query'), {
          body: { params: params.toString() },
        });
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Algolia unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), parent || '<root>');
      const data = (await response.json()) as { hits: AlgoliaRecord[]; nbPages: number; page: number };
      all.push(...data.hits);
      if (data.page + 1 >= data.nbPages || data.hits.length === 0) break;
      page = data.page + 1;
    }
    return Result.succeed(all);
  }

  /**
   * Bulk delete by query. Useful for purging a folder subtree in one round-trip;
   * we don't currently expose this through the repository but it's a thin layer
   * away if needed.
   */
  async deleteByFilter(filter: string): Promise<LaikaResult<void>> {
    const params = new URLSearchParams();
    params.set('filters', filter);
    let response: Response;
    try {
      response = await this.request('POST', this.indexPath('/deleteByQuery'), {
        body: { params: params.toString() },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Algolia unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), filter);
    return Result.succeed(undefined);
  }
}
