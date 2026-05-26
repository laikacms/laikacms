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

/** Mime-type marker Google uses for folders. */
export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';

/** OAuth2 access-token source. The caller owns the refresh flow. */
export interface GoogleDriveAuth {
  /** Static bearer access token. Use a `tokenProvider` instead for refreshable tokens. */
  readonly accessToken?: string;
  /** Async access-token provider; called before each request, so it can refresh on demand. */
  readonly tokenProvider?: () => string | Promise<string>;
  /** Extra headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link GoogleDriveDataSource}. */
export interface GoogleDriveDataSourceOptions {
  /** OAuth2 credentials — exactly one of `accessToken`/`tokenProvider` is required. */
  readonly auth: GoogleDriveAuth;
  /**
   * Drive folder id that acts as the storage root. Defaults to the user's
   * "My Drive" root (`'root'`). For multi-tenant or shared-drive usage, set
   * this to a concrete folder id you've provisioned for the project.
   */
  readonly rootFolderId?: string;
  /** Custom `fetch` implementation — handy for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** A single Drive file or folder as returned by the API. */
export interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly parents?: string[];
  readonly createdTime?: string;
  readonly modifiedTime?: string;
  readonly size?: string;
  readonly md5Checksum?: string;
  readonly version?: string;
}

/** Default `fields` mask used everywhere — keeps Drive responses small and predictable. */
const FILE_FIELDS = 'id,name,mimeType,parents,createdTime,modifiedTime,size,md5Checksum,version';
const LIST_FIELDS = `files(${FILE_FIELDS}),nextPageToken`;

/** Escape a literal value for use inside a Drive `q=` query. Single quotes are the only thing to worry about. */
const escapeQ = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Map a non-2xx Drive HTTP response onto a Laika error. */
const errorForStatus = <T>(status: number, context: string, body?: string): LaikaResult<T> => {
  const detail = body && body.length > 0 ? `: ${body.slice(0, 200)}` : '';
  switch (status) {
    case 400:
      return Result.fail(new InternalError(`Drive rejected request for ${context}${detail}`));
    case 401:
      return Result.fail(new AuthenticationError(`Drive authentication failed for ${context}`));
    case 403:
      return Result.fail(new ForbiddenError(`Drive access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Drive resource not found: ${context}`));
    case 409:
    case 412:
      return Result.fail(new ConflictError(`Drive conflict for ${context}${detail}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Drive rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Drive service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Drive returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Drive returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the Google Drive REST v3 API over `fetch`. Path → file-id resolution
 * walks the folder tree from the configured root; results are cached in a
 * tiny in-memory map per instance, so repeated lookups under the same
 * directory only pay one round-trip the first time.
 *
 * The caller owns the OAuth2 dance — pass a static `accessToken` for
 * short-lived scripts or a `tokenProvider` callback so this datasource can
 * pick up refreshed tokens transparently.
 */
export class GoogleDriveDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: GoogleDriveAuth;
  private readonly rootFolderId: string;
  /** Cache of full path -> file id. Cleared on writes that could shift the tree. */
  private readonly pathCache = new Map<string, string>();

  constructor(options: GoogleDriveDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via GoogleDriveDataSourceOptions.fetch');
    }
    this.auth = options.auth;
    this.rootFolderId = options.rootFolderId ?? 'root';
    if (!this.auth.accessToken && !this.auth.tokenProvider) {
      throw new InternalError('GoogleDriveDataSource requires `auth.accessToken` or `auth.tokenProvider`');
    }
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.accessToken as string;
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: string, headers?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(this.auth.headers ?? {}),
      ...(init?.headers ?? {}),
    };
    return this.fetchImpl(url, { method, headers, body: init?.body });
  }

  /** GET a single file's metadata. */
  async getFileMeta(fileId: string): Promise<LaikaResult<DriveFile>> {
    try {
      const response = await this.request(
        'GET',
        `${DRIVE_API_URL}/files/${encodeURIComponent(fileId)}?fields=${
          encodeURIComponent(FILE_FIELDS)
        }&supportsAllDrives=true`,
      );
      if (!response.ok) return errorForStatus(response.status, fileId, await safeText(response));
      return Result.succeed((await response.json()) as DriveFile);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Drive unreachable', { cause }));
    }
  }

  /** GET a file's content. */
  async getFileContent(fileId: string): Promise<LaikaResult<string>> {
    try {
      const response = await this.request(
        'GET',
        `${DRIVE_API_URL}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      );
      if (!response.ok) return errorForStatus(response.status, fileId, await safeText(response));
      return Result.succeed(await response.text());
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Drive unreachable', { cause }));
    }
  }

  /**
   * Search for a single child of `parentId` by exact name. Returns `null`
   * when nothing matches; if multiple files share the same name (Drive
   * permits this), the first hit wins — see the README caveat.
   */
  async findChild(parentId: string, name: string): Promise<LaikaResult<DriveFile | null>> {
    const q = `name = '${escapeQ(name)}' and '${escapeQ(parentId)}' in parents and trashed = false`;
    try {
      const response = await this.request(
        'GET',
        `${DRIVE_API_URL}/files?q=${encodeURIComponent(q)}&fields=${
          encodeURIComponent(LIST_FIELDS)
        }&pageSize=2&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      );
      if (!response.ok) return errorForStatus(response.status, `${parentId}/${name}`, await safeText(response));
      const data = (await response.json()) as { files?: DriveFile[] };
      return Result.succeed(data.files?.[0] ?? null);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Drive unreachable', { cause }));
    }
  }

  /** List the direct children of a folder, paging through `nextPageToken`. */
  async listChildren(parentId: string): Promise<LaikaResult<DriveFile[]>> {
    const q = `'${escapeQ(parentId)}' in parents and trashed = false`;
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const url = new URL(`${DRIVE_API_URL}/files`);
        url.searchParams.set('q', q);
        url.searchParams.set('fields', LIST_FIELDS);
        url.searchParams.set('pageSize', '1000');
        url.searchParams.set('supportsAllDrives', 'true');
        url.searchParams.set('includeItemsFromAllDrives', 'true');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const response = await this.request('GET', url.toString());
        if (!response.ok) return errorForStatus(response.status, parentId, await safeText(response));
        const data = (await response.json()) as { files?: DriveFile[], nextPageToken?: string };
        if (data.files) out.push(...data.files);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return Result.succeed(out);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Drive unreachable', { cause }));
    }
  }

  /**
   * Resolve a slash-delimited path to a file id by walking from the root.
   * The empty path resolves to the root folder. Misses are cached as
   * negative lookups would invalidate too easily — we just re-walk.
   */
  async resolvePath(path: string): Promise<LaikaResult<DriveFile | null>> {
    const trimmed = path.replace(/^\/+|\/+$/g, '');
    if (trimmed === '') {
      // Synthesise a minimal entry for the root.
      return Result.succeed({ id: this.rootFolderId, name: '', mimeType: FOLDER_MIME_TYPE });
    }
    const cachedId = this.pathCache.get(trimmed);
    if (cachedId) {
      const meta = await this.getFileMeta(cachedId);
      if (Result.isSuccess(meta)) return Result.succeed(meta.success);
      // Stale — fall through and re-walk.
      this.pathCache.delete(trimmed);
    }

    const segments = trimmed.split('/');
    let parentId = this.rootFolderId;
    let current: DriveFile | null = null;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const child = await this.findChild(parentId, segment);
      if (Result.isFailure(child)) return Result.fail(child.failure);
      if (!child.success) return Result.succeed(null);
      current = child.success;
      parentId = child.success.id;
    }
    if (current) this.pathCache.set(trimmed, current.id);
    return Result.succeed(current);
  }

  /** Resolve a path and require it to be a folder; returns its id or a NotFoundError. */
  async resolveFolderId(path: string): Promise<LaikaResult<string>> {
    const resolved = await this.resolvePath(path);
    if (Result.isFailure(resolved)) return Result.fail(resolved.failure);
    if (!resolved.success) return Result.fail(new NotFoundError(`Drive folder not found: ${path || '<root>'}`));
    if (resolved.success.mimeType !== FOLDER_MIME_TYPE) {
      return Result.fail(new NotFoundError(`Drive path "${path}" is a file, not a folder`));
    }
    return Result.succeed(resolved.success.id);
  }

  /** Create a folder under `parentId`. Returns the new folder's metadata. */
  async createFolder(parentId: string, name: string): Promise<LaikaResult<DriveFile>> {
    try {
      const response = await this.request(
        'POST',
        `${DRIVE_API_URL}/files?fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`,
        {
          body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] }),
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        },
      );
      if (!response.ok) return errorForStatus(response.status, `${parentId}/${name}`, await safeText(response));
      return Result.succeed((await response.json()) as DriveFile);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Drive unreachable', { cause }));
    }
  }

  /**
   * Idempotently ensure a folder chain exists under the root, creating any
   * missing intermediates. Returns the leaf folder's id.
   */
  async ensureFolderChain(path: string): Promise<LaikaResult<string>> {
    const trimmed = path.replace(/^\/+|\/+$/g, '');
    if (trimmed === '') return Result.succeed(this.rootFolderId);
    const segments = trimmed.split('/');
    let parentId = this.rootFolderId;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const existing = await this.findChild(parentId, segment);
      if (Result.isFailure(existing)) return Result.fail(existing.failure);
      if (existing.success && existing.success.mimeType === FOLDER_MIME_TYPE) {
        parentId = existing.success.id;
        continue;
      }
      if (existing.success) {
        return Result.fail(
          new ConflictError(
            `Cannot create folder "${segments.slice(0, i + 1).join('/')}" — a non-folder file blocks the path`,
          ),
        );
      }
      const created = await this.createFolder(parentId, segment);
      if (Result.isFailure(created)) return Result.fail(created.failure);
      parentId = created.success.id;
      this.pathCache.set(segments.slice(0, i + 1).join('/'), created.success.id);
    }
    return Result.succeed(parentId);
  }

  /** Create a file under `parentId` via Drive's multipart upload endpoint. */
  async createFile(
    parentId: string,
    name: string,
    content: string,
    contentType: string,
  ): Promise<LaikaResult<DriveFile>> {
    const boundary = `laika-${Math.random().toString(36).slice(2, 12)}`;
    const body = buildMultipartRelated(boundary, { name, parents: [parentId] }, content, contentType);
    try {
      const response = await this.request(
        'POST',
        `${DRIVE_UPLOAD_URL}/files?uploadType=multipart&fields=${
          encodeURIComponent(FILE_FIELDS)
        }&supportsAllDrives=true`,
        {
          body,
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        },
      );
      if (!response.ok) return errorForStatus(response.status, `${parentId}/${name}`, await safeText(response));
      return Result.succeed((await response.json()) as DriveFile);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Drive unreachable', { cause }));
    }
  }

  /** Replace a file's content. Drive's `uploadType=media` endpoint accepts a raw body. */
  async updateFileContent(
    fileId: string,
    content: string,
    contentType: string,
  ): Promise<LaikaResult<DriveFile>> {
    try {
      const response = await this.request(
        'PATCH',
        `${DRIVE_UPLOAD_URL}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${
          encodeURIComponent(FILE_FIELDS)
        }&supportsAllDrives=true`,
        {
          body: content,
          headers: { 'Content-Type': contentType },
        },
      );
      if (!response.ok) return errorForStatus(response.status, fileId, await safeText(response));
      return Result.succeed((await response.json()) as DriveFile);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Drive unreachable', { cause }));
    }
  }

  /** Permanently delete a file. Use the Drive UI if you want trash semantics instead. */
  async deleteFile(fileId: string): Promise<LaikaResult<void>> {
    try {
      const response = await this.request(
        'DELETE',
        `${DRIVE_API_URL}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      );
      // 204 = success; 404 is treated as success (already gone).
      if (response.ok || response.status === 404) return Result.succeed(undefined);
      return errorForStatus(response.status, fileId, await safeText(response));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Drive unreachable', { cause }));
    }
  }

  /** Clear the in-memory path → id cache. Call this if you've made changes via another channel. */
  clearPathCache(): void {
    this.pathCache.clear();
  }
}

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

/** Build a `multipart/related` body for Drive's upload endpoint. */
const buildMultipartRelated = (
  boundary: string,
  metadata: Record<string, unknown>,
  content: string,
  contentType: string,
): string => {
  const json = JSON.stringify(metadata);
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    json,
    `--${boundary}`,
    `Content-Type: ${contentType}`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
};
