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

const DEFAULT_API_URL = 'https://api.bitbucket.org/2.0';

/** Authentication for the Bitbucket Cloud REST API. */
export interface BitbucketAuth {
  /** App-password tuple. Sent as HTTP Basic. */
  readonly appPassword?: { readonly username: string; readonly password: string };
  /** OAuth2 access token. Sent as Bearer. */
  readonly oauthToken?: string;
  /** Async OAuth2 token provider — called before every request so refreshes are transparent. */
  readonly tokenProvider?: () => string | Promise<string>;
  /** Extra headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link BitbucketDataSource}. */
export interface BitbucketDataSourceOptions {
  readonly workspace: string;
  readonly repo: string;
  /** Branch every commit lands on. */
  readonly branch: string;
  readonly auth: BitbucketAuth;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /** Override the API base URL. Defaults to `https://api.bitbucket.org/2.0`. */
  readonly apiUrl?: string;
}

/** A single entry in a `/src/<commit>/<path>/` listing. */
export interface BitbucketDirEntry {
  readonly type: 'file' | 'dir';
  readonly path: string;
  readonly size?: number;
  /** Commit hash of the most recent commit that touched the entry. */
  readonly commit?: string;
}

/** Base64-encode a UTF-8 string without depending on `Buffer`. */
const base64Utf8 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; type?: string };
    if (parsed.error?.message) detail = `: ${parsed.error.message}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Bitbucket authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Bitbucket access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Bitbucket resource not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Bitbucket rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Bitbucket service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Bitbucket returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Bitbucket returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [Bitbucket Cloud REST API v2](https://developer.atlassian.com/cloud/bitbucket/rest/intro/)
 * over `fetch`. Bitbucket's commit model is unusual compared to GitHub/GitLab:
 *
 * - **All writes — creates, updates, and deletes — go through one endpoint**:
 *   `POST /repositories/{ws}/{repo}/src` with multipart form data. File
 *   uploads are form fields whose names are the paths and values are the
 *   content; file deletions are repeated `files=<path>` form fields. A
 *   single POST can contain any mix of writes and deletes, all committed
 *   atomically.
 * - **Listing requires a trailing slash.** `/src/<commit>/<path>/` returns
 *   a paginated directory listing; without the trailing slash the same URL
 *   returns the file's body (when it's a file).
 *
 * The datasource normalizes both quirks behind a clean method surface.
 */
export class BitbucketDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: BitbucketAuth;
  private readonly apiUrl: string;
  private readonly workspace: string;
  private readonly repo: string;
  private readonly branch: string;

  constructor(options: BitbucketDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via BitbucketDataSourceOptions.fetch');
    }
    if (!options.auth.appPassword && !options.auth.oauthToken && !options.auth.tokenProvider) {
      throw new InternalError(
        'BitbucketDataSource requires `auth.appPassword`, `auth.oauthToken`, or `auth.tokenProvider`',
      );
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.workspace = options.workspace;
    this.repo = options.repo;
    this.branch = options.branch;
  }

  private async authorizationHeader(): Promise<string> {
    if (this.auth.tokenProvider) return `Bearer ${await this.auth.tokenProvider()}`;
    if (this.auth.oauthToken) return `Bearer ${this.auth.oauthToken}`;
    const { username, password } = this.auth.appPassword!;
    return `Basic ${base64Utf8(`${username}:${password}`)}`;
  }

  private repoPath(rest: string): string {
    return `${this.apiUrl}/repositories/${encodeURIComponent(this.workspace)}/${encodeURIComponent(this.repo)}${rest}`;
  }

  /**
   * Encode a path for Bitbucket's `/src/...` URL. Slashes are preserved
   * (they're meaningful as path separators); each segment is URL-encoded
   * individually.
   */
  private encodePath(path: string): string {
    return path.split('/').filter(s => s.length > 0).map(encodeURIComponent).join('/');
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: BodyInit; headers?: Record<string, string> },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: await this.authorizationHeader(),
      ...(this.auth.headers ?? {}),
      ...(init?.headers ?? {}),
    };
    return this.fetchImpl(url, { method, headers, body: init?.body });
  }

  /** Fetch a file's raw content. */
  async getFileContents(path: string): Promise<LaikaResult<string>> {
    const encoded = this.encodePath(path);
    let response: Response;
    try {
      response = await this.request('GET', this.repoPath(`/src/${encodeURIComponent(this.branch)}/${encoded}`));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Bitbucket unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), path);
    return Result.succeed(await response.text());
  }

  /** Metadata for a file (size + last commit). `null` on 404. */
  async getFileMeta(
    path: string,
  ): Promise<LaikaResult<{ size: number; commit?: string; createdAt?: Date; updatedAt?: Date } | null>> {
    const encoded = this.encodePath(path);
    let response: Response;
    try {
      response = await this.request(
        'GET',
        `${this.repoPath(`/src/${encodeURIComponent(this.branch)}/${encoded}`)}?format=meta`,
      );
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Bitbucket unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), path);
    const data = (await response.json()) as {
      type: 'commit_file' | 'commit_directory';
      size?: number;
      commit?: { hash?: string; date?: string };
    };
    if (data.type !== 'commit_file') {
      return Result.succeed(null);
    }
    const date = data.commit?.date ? new Date(data.commit.date) : undefined;
    return Result.succeed({
      size: data.size ?? 0,
      commit: data.commit?.hash,
      // Bitbucket exposes only the last commit's date; treat it as both for now.
      createdAt: date,
      updatedAt: date,
    });
  }

  /** List a directory's direct children. Pages through `next` until exhausted. */
  async listDirectory(path: string): Promise<LaikaResult<BitbucketDirEntry[]>> {
    const encoded = this.encodePath(path);
    // Bitbucket only returns a directory listing when the URL has a trailing slash.
    const initialUrl = `${this.repoPath(`/src/${encodeURIComponent(this.branch)}/${encoded}`)}/?pagelen=100`;
    let url = initialUrl;
    const out: BitbucketDirEntry[] = [];
    let safety = 0;
    while (url) {
      safety += 1;
      if (safety > 100) return Result.fail(new InternalError(`Bitbucket pagination loop on "${path}"`));
      let response: Response;
      try {
        response = await this.request('GET', url);
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Bitbucket unreachable', { cause }));
      }
      if (response.status === 404) {
        return Result.fail(new NotFoundError(`Bitbucket directory not found: ${path || '<root>'}`));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), path || '<root>');
      const data = (await response.json()) as {
        values: Array<{
          type: 'commit_file' | 'commit_directory';
          path: string;
          size?: number;
          commit?: { hash?: string };
        }>;
        next?: string;
      };
      for (const entry of data.values) {
        out.push({
          type: entry.type === 'commit_directory' ? 'dir' : 'file',
          path: entry.path,
          size: entry.size,
          commit: entry.commit?.hash,
        });
      }
      url = data.next ?? '';
    }
    return Result.succeed(out);
  }

  /**
   * Commit one or more file additions/updates and/or deletions in a single
   * Bitbucket commit. `commitMessage` is the commit subject; `author` is the
   * optional `Name <email>` byline.
   */
  async commit(
    options: {
      puts?: ReadonlyArray<{ path: string; content: string }>;
      deletes?: ReadonlyArray<string>;
      commitMessage: string;
      author?: { name: string; email: string };
    },
  ): Promise<LaikaResult<void>> {
    const form = new FormData();
    form.set('branch', this.branch);
    form.set('message', options.commitMessage);
    if (options.author) {
      form.set('author', `${options.author.name} <${options.author.email}>`);
    }
    for (const { path, content } of options.puts ?? []) {
      // Bitbucket's POST /src expects each file's path as the form-field name
      // and the file content as the value.
      form.set(path, new Blob([content]));
    }
    for (const path of options.deletes ?? []) {
      form.append('files', path);
    }

    let response: Response;
    try {
      response = await this.request('POST', this.repoPath('/src'), { body: form });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Bitbucket unreachable', { cause }));
    }
    if (!response.ok) {
      return errorForResponse(
        response.status,
        await safeText(response),
        [...(options.puts ?? []).map(p => p.path), ...(options.deletes ?? [])].join(','),
      );
    }
    return Result.succeed(undefined);
  }

  /**
   * Convenience wrapper around {@link commit} for the common case of writing
   * one file. Matches the GitHub / GitLab datasources' shape so the
   * repository layer reads almost identically across the three platforms.
   */
  async createOrUpdate(
    path: string,
    content: string,
    options: { commitMessage?: string; author?: { name: string; email: string } } = {},
  ): Promise<LaikaResult<{ path: string }>> {
    const result = await this.commit({
      puts: [{ path, content }],
      commitMessage: options.commitMessage ?? `Update ${path}`,
      author: options.author,
    });
    if (Result.isFailure(result)) return Result.fail(result.failure);
    return Result.succeed({ path });
  }

  /** Convenience wrapper around {@link commit} for the common case of one delete. */
  async deleteFile(
    path: string,
    options: { commitMessage?: string; author?: { name: string; email: string } } = {},
  ): Promise<LaikaResult<{ path: string }>> {
    const result = await this.commit({
      deletes: [path],
      commitMessage: options.commitMessage ?? `Delete ${path}`,
      author: options.author,
    });
    if (Result.isFailure(result)) return Result.fail(result.failure);
    return Result.succeed({ path });
  }
}
