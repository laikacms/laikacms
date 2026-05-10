import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import * as Result from 'effect/Result';
import {
  ConflictError,
  DirInsteadOfFile,
  FileInsteadOfDir,
  ForbiddenError,
  InternalError,
  NotFoundError,
  VersionMismatchError,
} from 'laikacms/core';
import type { LaikaResult } from 'laikacms/core';

export interface GithubDataSourceOptions {
  appId: string | number;
  privateKey: string;
  installationId: string | number;
  owner: string;
  repo: string;
  branch: string;
  /** Optional Octokit override — useful for tests. */
  octokit?: Octokit;
  /** Token cache TTL in seconds. Installation tokens last ~1h; default refresh well before. */
  tokenTtlSeconds?: number;
  /** User-Agent string sent on all requests. */
  userAgent?: string;
}

interface GithubFile {
  path: string;
  sha: string;
  content: string;
  encoding: 'base64' | 'utf-8';
}

interface GithubDirEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'submodule' | 'symlink';
  sha: string;
}

const DEFAULT_TOKEN_TTL_SECONDS = 50 * 60;
const DEFAULT_USER_AGENT = '@laikacms/github';

/**
 * Convert a base64 string to UTF-8 text. Works in both Node and Workers
 * (no `Buffer` dependency).
 */
function base64ToText(b64: string): string {
  const binary = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Convert UTF-8 text to a base64 string. */
function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const isOctokitError = (e: unknown): e is { status: number, message?: string } =>
  typeof e === 'object' && e !== null && 'status' in e && typeof (e as { status: unknown }).status === 'number';

/**
 * I/O against a single GitHub repository. Stateless aside from a cached
 * installation token. All errors are mapped onto laikacms error types.
 */
export class GithubDataSource {
  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;
  private readonly userAgent: string;
  private readonly tokenTtlMs: number;

  private readonly externalOctokit?: Octokit;
  private readonly auth?: ReturnType<typeof createAppAuth>;

  private cachedOctokit?: Octokit;
  private cachedTokenExpiry = 0;

  constructor(opts: GithubDataSourceOptions) {
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.branch = opts.branch;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.tokenTtlMs = (opts.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000;

    if (opts.octokit) {
      this.externalOctokit = opts.octokit;
    } else {
      this.auth = createAppAuth({
        appId: opts.appId,
        privateKey: this.normalizePrivateKey(opts.privateKey),
        installationId: opts.installationId,
      });
    }
  }

  /**
   * GitHub App private keys are PEM strings. When passed via env vars they often arrive
   * with literal `\n` sequences and surrounding quotes — normalize those.
   */
  private normalizePrivateKey(raw: string): string {
    return raw.replace(/\\n/g, '\n').replace(/^"+|"+$/g, '');
  }

  /** Get an authenticated Octokit; mints a fresh installation token when the cached one expires. */
  private async getOctokit(): Promise<Octokit> {
    if (this.externalOctokit) return this.externalOctokit;
    if (this.cachedOctokit && Date.now() < this.cachedTokenExpiry) return this.cachedOctokit;

    const result = await this.auth!({ type: 'installation' });
    const token = (result as { token: string }).token;
    this.cachedOctokit = new Octokit({ auth: token, userAgent: this.userAgent });
    this.cachedTokenExpiry = Date.now() + this.tokenTtlMs;
    return this.cachedOctokit;
  }

  /**
   * Fetch a file's content + sha. Returns NotFound when the path is a directory or missing.
   */
  async getFileContents(relativePath: string): Promise<LaikaResult<{ content: string, sha: string, path: string }>> {
    try {
      const octokit = await this.getOctokit();
      const { data } = await octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: relativePath,
        ref: this.branch,
      });

      if (Array.isArray(data)) {
        return Result.fail(
          new DirInsteadOfFile(`Expected a file at ${relativePath} but found a directory`),
        );
      }
      if (data.type !== 'file' || !('content' in data)) {
        return Result.fail(
          new DirInsteadOfFile(`Expected a file at ${relativePath} but found ${data.type}`),
        );
      }

      const content = data.encoding === 'base64' ? base64ToText(data.content) : data.content;
      return Result.succeed({ content, sha: data.sha, path: relativePath });
    } catch (e) {
      return this.mapError<{ content: string, sha: string, path: string }>(e, relativePath);
    }
  }

  /** Get just the metadata (sha, lastModified) without downloading content. */
  async getFileMeta(
    relativePath: string,
  ): Promise<LaikaResult<{ sha: string, createdAt: Date, updatedAt: Date }>> {
    try {
      const octokit = await this.getOctokit();
      const { data } = await octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: relativePath,
        ref: this.branch,
      });
      if (Array.isArray(data) || data.type !== 'file') {
        return Result.fail(new DirInsteadOfFile(`Expected a file at ${relativePath}`));
      }

      const commitInfo = await this.getFirstAndLastCommitForFile(relativePath);
      return Result.succeed({
        sha: data.sha,
        createdAt: commitInfo.createdAt ?? new Date(0),
        updatedAt: commitInfo.updatedAt ?? new Date(0),
      });
    } catch (e) {
      return this.mapError<{ sha: string, createdAt: Date, updatedAt: Date }>(e, relativePath);
    }
  }

  /** Earliest and latest commit timestamps for a path. */
  private async getFirstAndLastCommitForFile(
    relativePath: string,
  ): Promise<{ createdAt?: Date, updatedAt?: Date }> {
    try {
      const octokit = await this.getOctokit();
      const { data: recent, headers } = await octokit.rest.repos.listCommits({
        owner: this.owner,
        repo: this.repo,
        path: relativePath,
        sha: this.branch,
        per_page: 1,
      });

      if (recent.length === 0) return {};
      const updatedAt = recent[0].commit.author?.date ?? recent[0].commit.committer?.date;

      const link = headers.link;
      const lastPage = link?.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/i)?.[1];
      let createdAt = updatedAt;

      if (lastPage && Number(lastPage) > 1) {
        const { data: first } = await octokit.rest.repos.listCommits({
          owner: this.owner,
          repo: this.repo,
          path: relativePath,
          sha: this.branch,
          per_page: 1,
          page: Number(lastPage),
        });
        createdAt = first[0]?.commit.author?.date ?? first[0]?.commit.committer?.date ?? updatedAt;
      }

      return {
        createdAt: createdAt ? new Date(createdAt) : undefined,
        updatedAt: updatedAt ? new Date(updatedAt) : undefined,
      };
    } catch {
      return {};
    }
  }

  /** List immediate children of a directory. Empty array when missing (mirrors storage-fs). */
  async listDirectory(relativePath: string): Promise<LaikaResult<GithubDirEntry[]>> {
    try {
      const octokit = await this.getOctokit();
      const { data } = await octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: relativePath,
        ref: this.branch,
      });

      if (!Array.isArray(data)) {
        return Result.fail(
          new FileInsteadOfDir(`Expected a directory at ${relativePath} but found a file`),
        );
      }

      return Result.succeed(
        data
          .filter(e => e.type === 'file' || e.type === 'dir')
          .map(e => ({ name: e.name, path: e.path, type: e.type, sha: e.sha })),
      );
    } catch (e) {
      if (isOctokitError(e) && e.status === 404) {
        // GitHub returns 404 for an empty directory. Treat as empty rather than missing —
        // matches storage-fs semantics where listing an empty dir yields [].
        return Result.succeed([]);
      }
      return this.mapError<GithubDirEntry[]>(e, relativePath);
    }
  }

  /**
   * Create or update a file. If `expectedSha` is supplied, the API enforces optimistic
   * concurrency: a 409 response maps to VersionMismatchError.
   */
  async createOrUpdate(
    relativePath: string,
    content: string,
    options: { expectedSha?: string, commitMessage?: string, author?: { name: string, email: string } } = {},
  ): Promise<LaikaResult<{ sha: string, path: string }>> {
    try {
      const octokit = await this.getOctokit();
      const message = options.commitMessage
        ?? `${options.expectedSha ? 'Update' : 'Create'} ${relativePath}`;

      // GitHub's createOrUpdateFileContents API requires a `sha` to update an existing file.
      // When no expectedSha is given but a file exists, we look it up first to allow upserts.
      let sha = options.expectedSha;
      if (!sha) {
        const existing = await this.getFileContents(relativePath);
        if (Result.isSuccess(existing)) sha = existing.success.sha;
      }

      const { data } = await octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path: relativePath,
        message,
        content: textToBase64(content),
        branch: this.branch,
        sha,
        committer: options.author,
      });

      const newSha = data.content?.sha;
      if (!newSha) {
        return Result.fail(new InternalError('GitHub did not return a sha for the written file'));
      }
      return Result.succeed({ sha: newSha, path: relativePath });
    } catch (e) {
      return this.mapError<{ sha: string, path: string }>(e, relativePath);
    }
  }

  /** Delete a file by sha. Empty-folder semantics are handled at the repository layer. */
  async deleteFile(
    relativePath: string,
    sha: string,
    options: { commitMessage?: string, author?: { name: string, email: string } } = {},
  ): Promise<LaikaResult<{ path: string }>> {
    try {
      const octokit = await this.getOctokit();
      await octokit.repos.deleteFile({
        owner: this.owner,
        repo: this.repo,
        path: relativePath,
        message: options.commitMessage ?? `Delete ${relativePath}`,
        sha,
        branch: this.branch,
        committer: options.author,
      });
      return Result.succeed({ path: relativePath });
    } catch (e) {
      return this.mapError<{ path: string }>(e, relativePath);
    }
  }

  /**
   * Distinguish file vs dir vs missing. Throws NotFoundError for missing paths so the caller
   * can decide whether that's terminal — matches storage-fs.isDir behavior.
   */
  async pathType(relativePath: string): Promise<'file' | 'dir'> {
    const octokit = await this.getOctokit();
    try {
      const { data } = await octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: relativePath,
        ref: this.branch,
      });
      return Array.isArray(data) ? 'dir' : 'file';
    } catch (e) {
      if (isOctokitError(e) && e.status === 404) {
        throw new NotFoundError(`The path at ${relativePath} does not exist`);
      }
      throw e;
    }
  }

  private mapError<T>(error: unknown, contextPath: string): LaikaResult<T> {
    if (!isOctokitError(error)) {
      return Result.fail(
        new InternalError(`GitHub request failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    switch (error.status) {
      case 404:
        return Result.fail(new NotFoundError(`The file at ${contextPath} does not exist`));
      case 401:
      case 403:
        return Result.fail(
          new ForbiddenError(`Access denied for ${contextPath}: ${error.message ?? 'forbidden'}`),
        );
      case 409:
      case 422:
        return Result.fail(
          new VersionMismatchError(
            `Conflict writing ${contextPath}: someone else modified the file since you last viewed it.`,
          ),
        );
      default:
        return Result.fail(
          new InternalError(`GitHub returned ${error.status} for ${contextPath}: ${error.message ?? 'error'}`),
        );
    }
  }
}

export { ConflictError };
