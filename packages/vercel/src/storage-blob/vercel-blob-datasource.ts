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

/**
 * The public Vercel Blob API surface.
 *
 * Vercel Blob is a hosted blob store that fronts the upstream object store
 * over `https://blob.vercel-storage.com`. The wire shape is unusual for two
 * reasons:
 *
 *   1. **Uploads add a random suffix by default.** `PUT /<pathname>` returns
 *      a URL like `https://<token-id>.public.blob.vercel-storage.com/<pathname>-<8-char-suffix>`
 *      unless `?addRandomSuffix=0` is set. We always disable the suffix —
 *      Laika owns the key, and a non-deterministic URL would force a read
 *      lookup before every overwrite.
 *
 *   2. **Deletes go through `POST /delete` with URLs in the body.** Not a
 *      `DELETE /<pathname>` like every other blob store. The single endpoint
 *      accepts an array of URLs and removes them atomically (well — best
 *      effort; Vercel does not document atomicity).
 */
const DEFAULT_API_URL = 'https://blob.vercel-storage.com';

export interface VercelBlobAuth {
  /** Read/write token from the Vercel dashboard (`BLOB_READ_WRITE_TOKEN`). */
  readonly token?: string;
  /** Async token provider — overrides `token` when present. */
  readonly tokenProvider?: () => string | Promise<string>;
  /** Extra headers merged onto every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface VercelBlobDataSourceOptions {
  readonly auth: VercelBlobAuth;
  /** Override the API base. Defaults to `https://blob.vercel-storage.com`. */
  readonly apiUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Shape returned by `PUT /<pathname>`. */
export interface VercelBlobUploadResult {
  /** Final public URL (with or without random suffix). */
  readonly url: string;
  /** Path the upload was stored under (matches the request pathname). */
  readonly pathname: string;
  readonly contentType?: string;
  readonly contentDisposition?: string;
}

/** Shape of an entry returned by `GET /` (list). */
export interface VercelBlobListEntry {
  readonly url: string;
  readonly pathname: string;
  readonly size: number;
  readonly uploadedAt: string;
}

export interface VercelBlobListPage {
  readonly blobs: VercelBlobListEntry[];
  readonly cursor?: string;
  readonly hasMore: boolean;
}

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  const detail = body ? `: ${body.slice(0, 200)}` : '';
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Vercel Blob authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Vercel Blob access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Vercel Blob not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Vercel Blob rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Vercel Blob service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Vercel Blob returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Vercel Blob returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the Vercel Blob HTTP API over `fetch`. Three endpoints carry the work:
 *
 * - `PUT /<pathname>?addRandomSuffix=0` — upload binary content; returns the
 *   public URL. We always disable the random suffix so the key→URL mapping is
 *   deterministic.
 * - `HEAD/GET <url>` — fetch by URL (not by pathname). Vercel routes blob
 *   reads through a separate CDN host, not through `blob.vercel-storage.com`.
 * - `POST /delete` body `{urls: [...]}` — bulk delete by URL. **Unique to
 *   Vercel Blob** — no other backend in the suite deletes by URL.
 * - `GET /?prefix=…&cursor=…&limit=…` — paginated listing with prefix filter.
 */
export class VercelBlobDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: VercelBlobAuth;
  private readonly apiUrl: string;

  constructor(options: VercelBlobDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via VercelBlobDataSourceOptions.fetch',
      );
    }
    if (!options.auth.token && !options.auth.tokenProvider) {
      throw new InternalError(
        'VercelBlobDataSource requires `auth.token` or `auth.tokenProvider`',
      );
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.token as string;
  }

  /**
   * Upload binary content at `pathname`. The Vercel default of appending a
   * random suffix is disabled — the caller (i.e. the repository) owns the
   * key, and a random suffix would break deterministic overwrite.
   */
  async put(
    pathname: string,
    content: Uint8Array | ArrayBuffer | string,
    options: { contentType?: string } = {},
  ): Promise<LaikaResult<VercelBlobUploadResult>> {
    const url = `${this.apiUrl}/${encodePathname(pathname)}?addRandomSuffix=0`;
    const headers: Record<string, string> = {
      // x-content-type is the Vercel-specific header — Content-Type alone
      // gets stripped by Vercel's upload proxy.
      'x-content-type': options.contentType ?? 'application/octet-stream',
    };
    let response: Response;
    try {
      response = await this.request('PUT', url, {
        body: typeof content === 'string'
          ? content
          : (content instanceof ArrayBuffer
              ? new Uint8Array(content)
              : content) as BodyInit,
        headers,
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Vercel Blob unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), pathname);
    const body = await response.json() as VercelBlobUploadResult;
    return Result.succeed(body);
  }

  /**
   * Fetch the bytes at `url`. Vercel routes reads through a CDN host (the
   * `url` field returned by `put`), not through the API base — so we fetch
   * the URL directly, no auth header.
   */
  async fetchByUrl(url: string): Promise<LaikaResult<{ body: string; contentType?: string } | null>> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: 'GET' });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Vercel Blob CDN unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), url);
    const body = await response.text();
    return Result.succeed({ body, contentType: response.headers.get('content-type') ?? undefined });
  }

  /**
   * Delete a set of URLs in one round-trip. Vercel returns `200 OK` whether
   * the URL existed or not — 404-on-missing is not raised here.
   */
  async deleteByUrls(urls: string[]): Promise<LaikaResult<void>> {
    if (urls.length === 0) return Result.succeed(undefined);
    let response: Response;
    try {
      response = await this.request('POST', `${this.apiUrl}/delete`, {
        body: JSON.stringify({ urls }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Vercel Blob unreachable', { cause }));
    }
    if (response.ok) return Result.succeed(undefined);
    return errorForResponse(response.status, await safeText(response), `delete(${urls.length})`);
  }

  /** Paginated list with optional prefix filter. */
  async list(
    options: { prefix?: string; cursor?: string; limit?: number } = {},
  ): Promise<LaikaResult<VercelBlobListPage>> {
    const url = new URL(this.apiUrl + '/');
    if (options.prefix !== undefined) url.searchParams.set('prefix', options.prefix);
    if (options.cursor) url.searchParams.set('cursor', options.cursor);
    if (options.limit !== undefined) url.searchParams.set('limit', String(options.limit));

    let response: Response;
    try {
      response = await this.request('GET', url.toString());
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Vercel Blob unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `list(${options.prefix ?? ''})`);
    const body = await response.json() as VercelBlobListPage;
    return Result.succeed(body);
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: BodyInit; headers?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.accessToken();
    return this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(this.auth.headers ?? {}),
        ...(init?.headers ?? {}),
      },
      body: init?.body,
    });
  }
}

/**
 * Percent-encode each path segment but keep `/` as a literal separator —
 * Vercel uses `/` as the in-key delimiter (not a folder, just a string),
 * and re-encoding it would land the blob at a URL nobody can browse.
 */
const encodePathname = (pathname: string): string =>
  pathname.split('/').map(encodeURIComponent).join('/');
