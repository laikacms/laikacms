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
  VersionMismatchError,
} from 'laikacms/core';

/** Authentication for the GitLab REST API. Exactly one of `token`/`oauthToken`/`jobToken` is used. */
export interface GitlabAuth {
  /** Personal access token. Sent as the `PRIVATE-TOKEN` header. */
  readonly token?: string;
  /** OAuth2 bearer token. Sent as `Authorization: Bearer …`. */
  readonly oauthToken?: string;
  /** CI job token. Sent as the `JOB-TOKEN` header. */
  readonly jobToken?: string;
  /** Extra headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link GitlabDataSource}. */
export interface GitlabDataSourceOptions {
  /**
   * Project identifier — either the numeric project ID (e.g. `12345`) or the
   * URL-encoded path (`group/subgroup/project`). The implementation
   * URL-encodes whatever you pass, so either form is accepted as-is.
   */
  readonly projectId: string | number;
  /** Branch to write to. Reads also default to this ref. */
  readonly branch: string;
  /** Authentication. Anonymous when omitted (only works for public reads). */
  readonly auth?: GitlabAuth;
  /** Base API URL. Defaults to `https://gitlab.com/api/v4` (override for self-hosted). */
  readonly apiUrl?: string;
  /** Custom `fetch` implementation — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /** User-Agent string. */
  readonly userAgent?: string;
}

/** A single entry in a GitLab repository tree listing. */
export interface GitlabDirEntry {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'dir';
  /** Blob id (files) or tree id (directories). */
  readonly sha: string;
}

const DEFAULT_API_URL = 'https://gitlab.com/api/v4';
const DEFAULT_USER_AGENT = '@laikacms/gitlab';

/** UTF-8-safe base64 encode without `Buffer`. */
const textToBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** UTF-8-safe base64 decode. */
const base64ToText = (b64: string): string => {
  const binary = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
};

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

interface RawTreeEntry {
  id: string;
  name: string;
  type: 'blob' | 'tree' | 'commit';
  path: string;
  mode: string;
}

interface RawFileEntry {
  file_path: string;
  file_name: string;
  encoding: 'base64' | 'text';
  content: string;
  blob_id: string;
  commit_id: string;
  last_commit_id: string;
  size: number;
}

interface RawCommit {
  id: string;
  authored_date?: string;
  committed_date?: string;
  created_at?: string;
}

/**
 * Talks the GitLab REST v4 API over `fetch`. Stateless — no token caching is
 * needed since PAT/OAuth tokens are long-lived (unlike GitHub App installation
 * tokens). All errors are mapped onto Laika error types.
 *
 * Project paths are accepted in either form (`12345` or `group/project`); the
 * implementation URL-encodes whatever you pass.
 */
export class GitlabDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;
  private readonly projectSegment: string;
  private readonly branch: string;
  private readonly userAgent: string;
  private readonly authHeaders: Readonly<Record<string, string>>;

  constructor(opts: GitlabDataSourceOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via GitlabDataSourceOptions.fetch');
    }
    this.apiUrl = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.projectSegment = encodeURIComponent(String(opts.projectId));
    this.branch = opts.branch;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.authHeaders = this.buildAuthHeaders(opts.auth);
  }

  private buildAuthHeaders(auth: GitlabAuth | undefined): Record<string, string> {
    const headers: Record<string, string> = { ...(auth?.headers ?? {}) };
    if (auth?.oauthToken) headers['Authorization'] = `Bearer ${auth.oauthToken}`;
    else if (auth?.token) headers['PRIVATE-TOKEN'] = auth.token;
    else if (auth?.jobToken) headers['JOB-TOKEN'] = auth.jobToken;
    return headers;
  }

  private url(path: string, query?: Record<string, string | number | undefined>): string {
    let qs = '';
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) params.append(k, String(v));
      }
      const s = params.toString();
      if (s !== '') qs = `?${s}`;
    }
    return `${this.apiUrl}/projects/${this.projectSegment}${path}${qs}`;
  }

  private async send(
    method: string,
    url: string,
    init?: { body?: unknown, headers?: Record<string, string> },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      ...this.authHeaders,
      ...(init?.headers ?? {}),
    };
    let body: string | undefined;
    if (init?.body !== undefined) {
      body = JSON.stringify(init.body);
      headers['Content-Type'] ??= 'application/json';
    }
    return this.fetchImpl(url, { method, headers, body });
  }

  /** Fetch a file's content + blob id. */
  async getFileContents(
    relativePath: string,
  ): Promise<LaikaResult<{ content: string, sha: string, path: string, lastCommitId: string }>> {
    const target = trimSlashes(relativePath);
    const url = this.url(`/repository/files/${encodeURIComponent(target)}`, { ref: this.branch });
    let response: Response;
    try {
      response = await this.send('GET', url);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('GitLab server unreachable', { cause }));
    }
    if (!response.ok) return this.mapStatus(response.status, target);

    const data = (await response.json()) as RawFileEntry;
    const content = data.encoding === 'base64' ? base64ToText(data.content) : data.content;
    return Result.succeed({
      content,
      sha: data.blob_id,
      path: target,
      lastCommitId: data.last_commit_id,
    });
  }

  /** Metadata for a file: blob id + first/last commit dates. */
  async getFileMeta(
    relativePath: string,
  ): Promise<LaikaResult<{ sha: string, lastCommitId: string, createdAt: Date, updatedAt: Date }>> {
    const file = await this.getFileContents(relativePath);
    if (Result.isFailure(file)) return Result.fail(file.failure);
    const commits = await this.getFirstAndLastCommit(relativePath);
    return Result.succeed({
      sha: file.success.sha,
      lastCommitId: file.success.lastCommitId,
      createdAt: commits.createdAt ?? new Date(0),
      updatedAt: commits.updatedAt ?? new Date(0),
    });
  }

  /** First (earliest) and last (most recent) commit timestamps for a path. */
  private async getFirstAndLastCommit(
    relativePath: string,
  ): Promise<{ createdAt?: Date, updatedAt?: Date }> {
    const url = this.url('/repository/commits', {
      path: trimSlashes(relativePath),
      ref_name: this.branch,
      per_page: 1,
    });
    let response: Response;
    try {
      response = await this.send('GET', url);
    } catch {
      return {};
    }
    if (!response.ok) return {};

    const commits = (await response.json()) as RawCommit[];
    if (commits.length === 0) return {};
    const updatedAt = parseDate(commits[0].committed_date ?? commits[0].authored_date ?? commits[0].created_at);

    const totalPages = Number(response.headers.get('x-total-pages') ?? '1');
    if (!Number.isFinite(totalPages) || totalPages <= 1) {
      return { createdAt: updatedAt, updatedAt };
    }

    let createdAt = updatedAt;
    try {
      const firstResp = await this.send(
        'GET',
        this.url('/repository/commits', {
          path: trimSlashes(relativePath),
          ref_name: this.branch,
          per_page: 1,
          page: totalPages,
        }),
      );
      if (firstResp.ok) {
        const first = (await firstResp.json()) as RawCommit[];
        const parsed = parseDate(
          first[0]?.committed_date ?? first[0]?.authored_date ?? first[0]?.created_at,
        );
        createdAt = parsed ?? updatedAt;
      }
    } catch {
      // Best-effort — fall back to `updatedAt` for `createdAt`.
    }
    return { createdAt, updatedAt };
  }

  /**
   * List the immediate children of a directory. Returns `[]` for an empty
   * directory; returns a {@link NotFoundError} only when the parent cannot be
   * resolved at all. Pages through `X-Next-Page` until exhausted.
   */
  async listDirectory(relativePath: string): Promise<LaikaResult<GitlabDirEntry[]>> {
    const path = trimSlashes(relativePath);
    const out: GitlabDirEntry[] = [];
    let page = 1;
    // GitLab caps per_page at 100.
    while (true) {
      const url = this.url('/repository/tree', {
        ref: this.branch,
        path: path === '' ? undefined : path,
        per_page: 100,
        page,
      });
      let response: Response;
      try {
        response = await this.send('GET', url);
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('GitLab server unreachable', { cause }));
      }
      if (response.status === 404) {
        // GitLab returns 404 for a path that does not resolve to a tree.
        // Mirror storage-fs/github semantics: empty dir = empty array;
        // missing path = NotFoundError surfaced by the caller.
        return Result.fail(new NotFoundError(`The directory at ${path || '<root>'} does not exist`));
      }
      if (!response.ok) return this.mapStatus(response.status, path || '<root>');

      const entries = (await response.json()) as RawTreeEntry[];
      for (const entry of entries) {
        if (entry.type !== 'blob' && entry.type !== 'tree') continue;
        out.push({
          name: entry.name,
          path: entry.path,
          type: entry.type === 'blob' ? 'file' : 'dir',
          sha: entry.id,
        });
      }
      const next = response.headers.get('x-next-page');
      if (!next || next.trim() === '' || next === '0') break;
      page = Number(next);
      if (!Number.isFinite(page) || page <= 0) break;
    }
    return Result.succeed(out);
  }

  /**
   * Create or update a file. Uses `POST` for new files and falls back to `PUT`
   * when the server reports the file already exists. `expectedLastCommitId`
   * enables optimistic concurrency on updates.
   */
  async createOrUpdate(
    relativePath: string,
    content: string,
    options: {
      expectedLastCommitId?: string,
      commitMessage?: string,
      author?: { name: string, email: string },
    } = {},
  ): Promise<LaikaResult<{ path: string }>> {
    const target = trimSlashes(relativePath);
    const url = this.url(`/repository/files/${encodeURIComponent(target)}`);
    const baseBody = {
      branch: this.branch,
      content: textToBase64(content),
      encoding: 'base64' as const,
      author_name: options.author?.name,
      author_email: options.author?.email,
    };

    // First try POST (create). On the "already exists" path (400 with a known
    // message) fall through to PUT (update) so the call is naturally upsert.
    const post = await this.tryWrite('POST', url, {
      ...baseBody,
      commit_message: options.commitMessage ?? `Create ${target}`,
    }, target);

    if (Result.isSuccess(post)) return Result.succeed({ path: target });
    if (!(post.failure instanceof ConflictError)) return Result.fail(post.failure);

    return this.tryWrite('PUT', url, {
      ...baseBody,
      commit_message: options.commitMessage ?? `Update ${target}`,
      last_commit_id: options.expectedLastCommitId,
    }, target).then(r => Result.isFailure(r) ? Result.fail(r.failure) : Result.succeed({ path: target }));
  }

  /** Issue a single create/update request and map errors. Used by {@link createOrUpdate}. */
  private async tryWrite(
    method: 'POST' | 'PUT',
    url: string,
    body: Record<string, unknown>,
    contextPath: string,
  ): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.send(method, url, { body });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('GitLab server unreachable', { cause }));
    }
    if (response.ok) return Result.succeed(undefined);

    // 400 with "already exists" is the create-on-existing path.
    if (response.status === 400) {
      const text = await response.text().catch(() => '');
      if (/already exists/i.test(text)) {
        return Result.fail(new ConflictError(`File at ${contextPath} already exists`));
      }
      return Result.fail(new InternalError(`GitLab rejected ${method} ${contextPath}: ${text}`));
    }
    return this.mapStatus(response.status, contextPath);
  }

  /** Delete a file. */
  async deleteFile(
    relativePath: string,
    options: { commitMessage?: string, author?: { name: string, email: string } } = {},
  ): Promise<LaikaResult<{ path: string }>> {
    const target = trimSlashes(relativePath);
    const url = this.url(`/repository/files/${encodeURIComponent(target)}`);
    let response: Response;
    try {
      response = await this.send('DELETE', url, {
        body: {
          branch: this.branch,
          commit_message: options.commitMessage ?? `Delete ${target}`,
          author_name: options.author?.name,
          author_email: options.author?.email,
        },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('GitLab server unreachable', { cause }));
    }
    if (!response.ok) return this.mapStatus(response.status, target);
    return Result.succeed({ path: target });
  }

  /**
   * Distinguish file vs dir vs missing. Looks up the parent listing and
   * inspects the entry — one request rather than two, and works for empty
   * directories (which still appear in their parent's tree).
   */
  async pathType(relativePath: string): Promise<'file' | 'dir'> {
    const target = trimSlashes(relativePath);
    if (target === '') return 'dir';
    const lastSlash = target.lastIndexOf('/');
    const parent = lastSlash >= 0 ? target.slice(0, lastSlash) : '';
    const name = lastSlash >= 0 ? target.slice(lastSlash + 1) : target;

    const listing = await this.listDirectory(parent);
    if (Result.isFailure(listing)) throw listing.failure;
    const entry = listing.success.find(e => e.name === name);
    if (!entry) throw new NotFoundError(`The path at ${target} does not exist`);
    return entry.type;
  }

  /** Map a non-2xx HTTP status onto the matching LaikaError. */
  private mapStatus<T>(status: number, contextPath: string): LaikaResult<T> {
    switch (status) {
      case 401:
        return Result.fail(new AuthenticationError(`GitLab authentication failed for ${contextPath}`));
      case 403:
        return Result.fail(new ForbiddenError(`GitLab access forbidden for ${contextPath}`));
      case 404:
        return Result.fail(new NotFoundError(`GitLab resource not found: ${contextPath}`));
      case 405:
        return Result.fail(new ForbiddenError(`GitLab method not allowed for ${contextPath}`));
      case 409:
      case 412:
        return Result.fail(
          new VersionMismatchError(
            `Conflict writing ${contextPath}: someone else modified the file since you last viewed it.`,
          ),
        );
      case 422:
        return Result.fail(
          new VersionMismatchError(`GitLab rejected the write for ${contextPath} (likely a stale last_commit_id)`),
        );
      case 429:
        return Result.fail(new TooManyRequestsError(`GitLab rate-limited request for ${contextPath}`));
      case 503:
        return Result.fail(new ServiceUnavailableError(`GitLab server unavailable for ${contextPath}`));
      default:
        if (status >= 500) {
          return Result.fail(new ServiceUnavailableError(`GitLab returned HTTP ${status} for ${contextPath}`));
        }
        return Result.fail(new InternalError(`GitLab returned HTTP ${status} for ${contextPath}`));
    }
  }
}

const parseDate = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
