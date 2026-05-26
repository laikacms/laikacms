import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from 'laikacms/core';

export const DROPBOX_FOLDER_TAG = 'folder' as const;
export const DROPBOX_FILE_TAG = 'file' as const;

/** Default endpoints — overridable for tests. */
const DROPBOX_API_URL = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_URL = 'https://content.dropboxapi.com/2';

/** OAuth2 access-token source. The caller owns the refresh flow. */
export interface DropboxAuth {
  /** Static bearer access token. Use `tokenProvider` instead for refreshable tokens. */
  readonly accessToken?: string;
  /** Async access-token provider; called before every request. */
  readonly tokenProvider?: () => string | Promise<string>;
  /** Extra headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link DropboxDataSource}. */
export interface DropboxDataSourceOptions {
  readonly auth: DropboxAuth;
  /** Custom `fetch` implementation — handy for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /** Override the metadata-API base URL (`https://api.dropboxapi.com/2`). */
  readonly apiUrl?: string;
  /** Override the content-API base URL (`https://content.dropboxapi.com/2`). */
  readonly contentUrl?: string;
  /**
   * Optional root path under which all storage operations are scoped. Defaults
   * to the app's root in Dropbox; set this to `/laika-content` to namespace
   * a single Dropbox account into multiple Laika stores.
   */
  readonly rootPath?: string;
}

/** A Dropbox file or folder as returned by the API. */
export interface DropboxEntry {
  readonly '.tag': 'file' | 'folder' | 'deleted';
  readonly name: string;
  readonly path_display?: string;
  readonly path_lower?: string;
  readonly id?: string;
  readonly client_modified?: string;
  readonly server_modified?: string;
  readonly rev?: string;
  readonly size?: number;
  readonly content_hash?: string;
}

/** Turn an arbitrary user key (no leading slash) into a Dropbox API path under the root. */
const toDropboxPath = (rootPath: string, key: string): string => {
  const cleanRoot = rootPath.replace(/\/+$/, '').replace(/^([^/])/, '/$1');
  const cleanKey = key.replace(/^\/+/, '').replace(/\/+$/, '');
  if (cleanKey === '') return cleanRoot;
  const base = cleanRoot === '' || cleanRoot === '/' ? '' : cleanRoot;
  return `${base}/${cleanKey}`;
};

/** Strip the configured root prefix off a Dropbox `path_display` and return the caller-facing key. */
const stripRoot = (rootPath: string, dropboxPath: string | undefined): string => {
  if (!dropboxPath) return '';
  const cleanRoot = rootPath.replace(/\/+$/, '').replace(/^([^/])/, '/$1');
  if (cleanRoot === '' || cleanRoot === '/') return dropboxPath.replace(/^\/+/, '');
  if (dropboxPath === cleanRoot) return '';
  return dropboxPath.startsWith(`${cleanRoot}/`)
    ? dropboxPath.slice(cleanRoot.length + 1)
    : dropboxPath.replace(/^\/+/, '');
};

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

/** Map a Dropbox HTTP status onto a Laika error, peeking at the body to refine 409s. */
const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  const trimmed = body.slice(0, 300);
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Dropbox authentication failed for ${context}`));
    case 403:
      return Result.fail(new ForbiddenError(`Dropbox access denied for ${context}: ${trimmed}`));
    case 409: {
      // Dropbox's 409 body shape: { error_summary: "path/not_found/..." }
      if (/not_found/.test(body)) return Result.fail(new NotFoundError(`Dropbox path not found: ${context}`));
      if (/conflict/.test(body)) return Result.fail(new ConflictError(`Dropbox conflict for ${context}: ${trimmed}`));
      return Result.fail(new ConflictError(`Dropbox rejected ${context}: ${trimmed}`));
    }
    case 429:
      return Result.fail(new TooManyRequestsError(`Dropbox rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Dropbox returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Dropbox returned HTTP ${status} for ${context}: ${trimmed}`));
  }
};

/**
 * Talks the [Dropbox HTTP API v2](https://www.dropbox.com/developers/documentation/http/documentation)
 * over `fetch`. Splits cleanly between the metadata API (RPC over JSON,
 * `api.dropboxapi.com`) and the content API (RPC + a streamed body or
 * `Dropbox-API-Arg` header, `content.dropboxapi.com`).
 *
 * The caller owns the OAuth2 flow — either pass a static `accessToken` or a
 * `tokenProvider` callback so refreshes are picked up transparently between
 * requests.
 */
export class DropboxDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: DropboxAuth;
  private readonly apiUrl: string;
  private readonly contentUrl: string;
  private readonly rootPath: string;

  constructor(options: DropboxDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via DropboxDataSourceOptions.fetch');
    }
    if (!options.auth.accessToken && !options.auth.tokenProvider) {
      throw new InternalError('DropboxDataSource requires `auth.accessToken` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DROPBOX_API_URL).replace(/\/+$/, '');
    this.contentUrl = (options.contentUrl ?? DROPBOX_CONTENT_URL).replace(/\/+$/, '');
    this.rootPath = options.rootPath ?? '';
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.accessToken as string;
  }

  /** Combine the configured root with a caller-facing key. Exposed for the repository. */
  pathFor(key: string): string {
    return toDropboxPath(this.rootPath, key);
  }

  /** Inverse of {@link pathFor} — strip the configured root prefix off a Dropbox path. */
  keyFor(dropboxPath: string | undefined): string {
    return stripRoot(this.rootPath, dropboxPath);
  }

  /** POST a JSON-RPC call against the metadata API. */
  private async rpc<T>(endpoint: string, body: unknown, context: string): Promise<LaikaResult<T>> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(this.auth.headers ?? {}),
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Dropbox unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), context);
    return Result.succeed((await response.json()) as T);
  }

  /** GET metadata for a single file or folder. `null` on `path/not_found`. */
  async getMetadata(key: string): Promise<LaikaResult<DropboxEntry | null>> {
    const path = this.pathFor(key);
    if (path === '' || path === '/') {
      // Dropbox refuses `get_metadata` on the root — synthesise the equivalent response.
      return Result.succeed({ '.tag': 'folder', name: '', path_display: path } satisfies DropboxEntry);
    }
    const out = await this.rpc<DropboxEntry>('/files/get_metadata', { path }, key || '<root>');
    if (Result.isFailure(out)) {
      if (out.failure instanceof NotFoundError) return Result.succeed(null);
      return Result.fail(out.failure);
    }
    return Result.succeed(out.success);
  }

  /** Download a file's content via the content API. */
  async downloadFile(key: string): Promise<LaikaResult<{ content: string, meta: DropboxEntry }>> {
    const token = await this.accessToken();
    const path = this.pathFor(key);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.contentUrl}/files/download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Dropbox-API-Arg': JSON.stringify({ path }),
          ...(this.auth.headers ?? {}),
        },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Dropbox unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), key);
    const apiResult = response.headers.get('dropbox-api-result');
    const meta = apiResult ? (JSON.parse(apiResult) as DropboxEntry) : { '.tag': 'file', name: key } as DropboxEntry;
    return Result.succeed({ content: await response.text(), meta });
  }

  /**
   * Upload a file's content. `mode` controls write semantics:
   *  - `'add'`: create-only, fails if the path already exists
   *  - `'overwrite'`: replace any existing file at the path
   *  - `{ update: <rev> }`: optimistic-concurrency update (fails if rev no longer matches)
   */
  async uploadFile(
    key: string,
    content: string,
    mode: 'add' | 'overwrite' | { update: string } = 'overwrite',
  ): Promise<LaikaResult<DropboxEntry>> {
    const token = await this.accessToken();
    const path = this.pathFor(key);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.contentUrl}/files/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({
            path,
            mode: typeof mode === 'string' ? mode : { '.tag': 'update', update: mode.update },
            autorename: false,
            mute: true,
            strict_conflict: false,
          }),
          ...(this.auth.headers ?? {}),
        },
        body: content,
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Dropbox unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), key);
    return Result.succeed((await response.json()) as DropboxEntry);
  }

  /** List the direct children of a folder, paging through `cursor`. */
  async listFolder(key: string): Promise<LaikaResult<DropboxEntry[]>> {
    const path = this.pathFor(key);
    const initial = await this.rpc<{ entries: DropboxEntry[], cursor: string, has_more: boolean }>(
      '/files/list_folder',
      { path, recursive: false, include_non_downloadable_files: false },
      key || '<root>',
    );
    if (Result.isFailure(initial)) return Result.fail(initial.failure);
    const out: DropboxEntry[] = [...initial.success.entries];
    let cursor = initial.success.cursor;
    let hasMore = initial.success.has_more;
    while (hasMore) {
      const next = await this.rpc<{ entries: DropboxEntry[], cursor: string, has_more: boolean }>(
        '/files/list_folder/continue',
        { cursor },
        key || '<root>',
      );
      if (Result.isFailure(next)) return Result.fail(next.failure);
      out.push(...next.success.entries);
      cursor = next.success.cursor;
      hasMore = next.success.has_more;
    }
    return Result.succeed(out);
  }

  /** Create a folder. Idempotent — a `path/conflict/folder` already-exists case is treated as success. */
  async createFolder(key: string): Promise<LaikaResult<DropboxEntry>> {
    const path = this.pathFor(key);
    const out = await this.rpc<{ metadata: DropboxEntry }>(
      '/files/create_folder_v2',
      { path, autorename: false },
      key,
    );
    if (Result.isSuccess(out)) return Result.succeed(out.success.metadata);

    // Folder already exists → look it up and return its current metadata.
    if (out.failure instanceof ConflictError) {
      const existing = await this.getMetadata(key);
      if (Result.isSuccess(existing) && existing.success?.['.tag'] === 'folder') {
        return Result.succeed(existing.success);
      }
    }
    return Result.fail(out.failure);
  }

  /** Idempotently create the entire ancestor chain of `folderKey`. */
  async ensureFolderChain(folderKey: string): Promise<LaikaResult<void>> {
    const trimmed = folderKey.replace(/^\/+|\/+$/g, '');
    if (trimmed === '') return Result.succeed(undefined);
    const segments = trimmed.split('/');
    for (let i = 0; i < segments.length; i++) {
      const sub = segments.slice(0, i + 1).join('/');
      const created = await this.createFolder(sub);
      if (Result.isFailure(created)) return Result.fail(created.failure);
    }
    return Result.succeed(undefined);
  }

  /** Permanently delete a path (file or folder). Trash is left to Dropbox's UI. */
  async deletePath(key: string): Promise<LaikaResult<void>> {
    const path = this.pathFor(key);
    const out = await this.rpc<{ metadata: DropboxEntry }>('/files/delete_v2', { path }, key);
    if (Result.isFailure(out)) {
      // 404 on a missing delete is treated as success — the caller wanted it gone.
      if (out.failure instanceof NotFoundError) return Result.succeed(undefined);
      return Result.fail(out.failure);
    }
    return Result.succeed(undefined);
  }
}
