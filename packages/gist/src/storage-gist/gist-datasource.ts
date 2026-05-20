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

const DEFAULT_API_URL = 'https://api.github.com';

/**
 * GitHub Gist filenames can't contain `/`, so the data source encodes any
 * `/` in a key as the two-character sequence `__`. Reversed by
 * {@link decodeGistFilename}. Keys that literally contain `__` are
 * rejected upfront at the repository layer.
 */
export const encodeGistFilename = (key: string): string => key.replace(/\//g, '__');
export const decodeGistFilename = (filename: string): string => filename.replace(/__/g, '/');

/** Auth for the GitHub Gist REST API. */
export interface GistAuth {
  /** GitHub PAT — Bearer-prefixed automatically. Needs the `gist` scope. */
  readonly token?: string;
  /** Async token provider — called before every request. */
  readonly tokenProvider?: () => string | Promise<string>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link GistDataSource}. */
export interface GistDataSourceOptions {
  /** ID of the existing Gist that backs the storage. Caller creates the Gist; this lib only mutates it. */
  readonly gistId: string;
  readonly auth: GistAuth;
  /** Override the API base URL. Defaults to `https://api.github.com`. */
  readonly apiUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /** User-Agent header value. GitHub requires one on every API call. */
  readonly userAgent?: string;
}

/** Subset of GitHub's `GistFile` shape the repository actually reads. */
export interface GistFile {
  readonly filename: string;
  readonly content?: string;
  readonly raw_url?: string;
  readonly size?: number;
  readonly truncated?: boolean;
}

/** Subset of GitHub's `Gist` response shape. */
export interface GistResponse {
  readonly id: string;
  readonly files: Record<string, GistFile>;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly history?: ReadonlyArray<{ version: string }>;
}

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
      return Result.fail(new AuthenticationError(`GitHub Gist authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`GitHub Gist access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`GitHub Gist not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`GitHub Gist rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`GitHub Gist service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`GitHub Gist returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`GitHub Gist returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [GitHub Gist API](https://docs.github.com/en/rest/gists/gists)
 * over `fetch`. Tiny API surface — three endpoints for the whole storage
 * contract:
 *
 * - `GET /gists/{id}` — fetch the gist with all files (paginated only when
 *   files are truncated by GitHub's size limits).
 * - `PATCH /gists/{id}` body `{files: {<filename>: {content} | null}}` —
 *   add, update, or delete files. **The whole file delta lands as one
 *   commit** — same atomic-multi-write pattern as Bitbucket's `POST /src`
 *   and Sanity's `/mutate`.
 * - `GET <raw_url>` — fetch a file's raw content when GitHub truncated it
 *   in the listing response.
 *
 * GitHub forbids `/` in gist filenames, so {@link encodeGistFilename} maps
 * `notes/hello.md` → `notes__hello.md` on the wire. Reversed on read.
 */
export class GistDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: GistAuth;
  private readonly apiUrl: string;
  private readonly gistId: string;
  private readonly userAgent: string;

  constructor(options: GistDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via GistDataSourceOptions.fetch');
    }
    if (!options.auth.token && !options.auth.tokenProvider) {
      throw new InternalError('GistDataSource requires `auth.token` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.gistId = options.gistId;
    this.userAgent = options.userAgent ?? '@laikacms/gist';
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.token as string;
  }

  private async request(method: string, url: string, body?: unknown): Promise<Response> {
    const token = await this.accessToken();
    return this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': this.userAgent,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.auth.headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /** Fetch the gist and return the full file map. */
  async getGist(): Promise<LaikaResult<GistResponse>> {
    let response: Response;
    try {
      response = await this.request('GET', `${this.apiUrl}/gists/${encodeURIComponent(this.gistId)}`);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('GitHub Gist unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), this.gistId);
    return Result.succeed((await response.json()) as GistResponse);
  }

  /** Resolve a file whose content was truncated by GitHub — fetch its `raw_url`. */
  async fetchRaw(rawUrl: string): Promise<LaikaResult<string>> {
    let response: Response;
    try {
      response = await this.request('GET', rawUrl);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('GitHub Gist unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), rawUrl);
    return Result.succeed(await response.text());
  }

  /**
   * Commit a batch of file additions/updates/deletes in **one** PATCH. A
   * `null` value in the map deletes that filename. Multiple changes in one
   * call land as a single commit in the Gist's history.
   */
  async commit(
    files: Record<string, { content: string } | null>,
  ): Promise<LaikaResult<GistResponse>> {
    let response: Response;
    try {
      response = await this.request(
        'PATCH',
        `${this.apiUrl}/gists/${encodeURIComponent(this.gistId)}`,
        { files },
      );
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('GitHub Gist unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), this.gistId);
    return Result.succeed((await response.json()) as GistResponse);
  }
}
