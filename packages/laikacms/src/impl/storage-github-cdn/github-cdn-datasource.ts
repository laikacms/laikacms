import * as Result from 'effect/Result';
import {
  DirInsteadOfFile,
  FileInsteadOfDir,
  InternalError,
  type LaikaResult,
  NotFoundError,
  TooManyRequestsError,
} from 'laikacms/core';

/**
 * Read-only I/O against a *public* GitHub repository, served entirely from CDNs —
 * no GitHub App, no OAuth, no API token, and no `@octokit/*` dependency.
 *
 * - **Content** comes from jsDelivr's file CDN (`cdn.jsdelivr.net/gh`).
 * - **Directory listings** come from jsDelivr's metadata API (`data.jsdelivr.com`),
 *   which returns the repo's full file tree as JSON.
 *
 * The trade-off versus {@link "@laikacms/github".GithubDataSource} is metadata:
 * a CDN carries no git history, so **commit timestamps are always epoch(0)**.
 * See {@link GithubCdnDataSourceOptions.fetchMeta} for the sha/revision behavior.
 *
 * Freshness note: CDN responses are cached (jsDelivr caches a ref for hours), so
 * this is best suited to serving mostly-static public content, not live editing.
 */
export type GithubCdnDataSourceOptions = {
  owner: string,
  repo: string,
  /** Branch, tag, or commit sha jsDelivr can resolve. Defaults to the repo's default branch. */
  branch?: string,
  /**
   * Controls how much work {@link GithubCdnDataSource.getFileMeta} does to produce a
   * `revisionId` (`sha`). Timestamps are epoch(0) either way — the CDN has no history.
   *
   * - `false` (default): no extra request. The `sha` is jsDelivr's content hash from
   *   the already-loaded file tree (empty string if the tree omits it).
   * - `true`: downloads the file to compute a canonical **git blob sha**, matching the
   *   `sha` that {@link GithubCdnDataSource.getFileContents} returns. Costs one fetch
   *   per metadata lookup.
   */
  fetchMeta?: boolean,
  /** Override the content CDN base. Default: `https://cdn.jsdelivr.net/gh`. */
  cdnBaseUrl?: string,
  /** Override the metadata/tree API base. Default: `https://data.jsdelivr.com/v1/packages/gh`. */
  dataApiBaseUrl?: string,
  /** Injectable fetch (tests, custom agents). Defaults to the global `fetch`. */
  fetch?: typeof fetch,
  /** User-Agent sent on all requests. */
  userAgent?: string,
};

interface GithubDirEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
}

interface JsDelivrTreeFile {
  type: 'file';
  name: string;
  hash?: string;
  size?: number;
}
interface JsDelivrTreeDir {
  type: 'directory';
  name: string;
  files: JsDelivrTreeNode[];
}
type JsDelivrTreeNode = JsDelivrTreeFile | JsDelivrTreeDir;

const DEFAULT_CDN_BASE = 'https://cdn.jsdelivr.net/gh';
const DEFAULT_DATA_API_BASE = 'https://data.jsdelivr.com/v1/packages/gh';
const DEFAULT_USER_AGENT = '@laikacms/github-cdn';
const EPOCH = new Date(0);

/** git blob object id: sha1("blob " + byteLength + "\0" + bytes). No deps — uses Web Crypto. */
async function gitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header, 0);
  bytes.set(body, header.length);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

const splitPath = (p: string): string[] => p.split('/').filter(Boolean);

export class GithubCdnDataSource {
  private readonly owner: string;
  private readonly repo: string;
  private readonly ref: string;
  private readonly fetchMeta: boolean;
  private readonly cdnBaseUrl: string;
  private readonly dataApiBaseUrl: string;
  private readonly userAgent: string;
  private readonly doFetch: typeof fetch;

  /** The repo file tree is fetched once and reused across listing/existence checks. */
  private treePromise?: Promise<JsDelivrTreeNode[]>;

  constructor(opts: GithubCdnDataSourceOptions) {
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.ref = opts.branch ?? 'HEAD';
    this.fetchMeta = opts.fetchMeta ?? false;
    this.cdnBaseUrl = (opts.cdnBaseUrl ?? DEFAULT_CDN_BASE).replace(/\/+$/, '');
    this.dataApiBaseUrl = (opts.dataApiBaseUrl ?? DEFAULT_DATA_API_BASE).replace(/\/+$/, '');
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.doFetch = opts.fetch ?? fetch;
  }

  private headers(): Record<string, string> {
    return { 'user-agent': this.userAgent };
  }

  /** Fetch (and cache) the full repo tree from jsDelivr's metadata API. */
  private getTree(): Promise<JsDelivrTreeNode[]> {
    if (!this.treePromise) {
      const url = `${this.dataApiBaseUrl}/${this.owner}/${this.repo}@${encodeURIComponent(this.ref)}?structure=tree`;
      this.treePromise = (async () => {
        const res = await this.doFetch(url, { headers: this.headers() });
        if (!res.ok) {
          // Cache-bust on failure so a transient error doesn't stick for the instance's life.
          this.treePromise = undefined;
          throw new InternalError(`jsDelivr metadata request failed (${res.status}) for ${this.owner}/${this.repo}`, {
            translation: { message: 'storage.githubCdn.unexpectedError' },
          });
        }
        const json = (await res.json()) as { files?: JsDelivrTreeNode[] };
        return json.files ?? [];
      })();
    }
    return this.treePromise;
  }

  /** Walk the cached tree to the node at `relativePath`, or `undefined` if absent. */
  private async findNode(relativePath: string): Promise<JsDelivrTreeNode | undefined> {
    const parts = splitPath(relativePath);
    let nodes = await this.getTree();
    let match: JsDelivrTreeNode | undefined;
    for (const part of parts) {
      match = nodes.find(n => n.name === part);
      if (!match) return undefined;
      nodes = match.type === 'directory' ? match.files : [];
    }
    return match;
  }

  private contentUrl(relativePath: string): string {
    const encoded = splitPath(relativePath).map(encodeURIComponent).join('/');
    return `${this.cdnBaseUrl}/${this.owner}/${this.repo}@${encodeURIComponent(this.ref)}/${encoded}`;
  }

  /** Fetch a file's content from the CDN plus a computed git blob sha. */
  async getFileContents(
    relativePath: string,
  ): Promise<LaikaResult<{ content: string, sha: string, path: string }>> {
    try {
      const res = await this.doFetch(this.contentUrl(relativePath), { headers: this.headers() });
      if (res.status === 404) {
        return Result.fail(
          new NotFoundError(`The file at ${relativePath} does not exist`, {
            translation: { message: 'storage.githubCdn.fileNotFound' },
          }),
        );
      }
      if (res.status === 429) {
        return Result.fail(
          new TooManyRequestsError(`CDN rate-limited request for ${relativePath}`, {
            translation: { message: 'storage.githubCdn.tooManyRequests' },
          }),
        );
      }
      if (!res.ok) {
        return Result.fail(
          new InternalError(`CDN returned ${res.status} for ${relativePath}`, {
            translation: { message: 'storage.githubCdn.unexpectedError' },
          }),
        );
      }
      const content = await res.text();
      const sha = await gitBlobSha(content);
      return Result.succeed({ content, sha, path: relativePath });
    } catch (e) {
      return Result.fail(
        new InternalError(`CDN request failed for ${relativePath}: ${e instanceof Error ? e.message : String(e)}`, {
          translation: { message: 'storage.githubCdn.unexpectedError' },
        }),
      );
    }
  }

  /**
   * Metadata for a file. Existence is resolved from the file tree. Timestamps are
   * always epoch(0). The `sha` depends on the {@link GithubCdnDataSourceOptions.fetchMeta} flag.
   */
  async getFileMeta(
    relativePath: string,
  ): Promise<LaikaResult<{ sha: string, createdAt: Date, updatedAt: Date }>> {
    try {
      const node = await this.findNode(relativePath);
      if (!node) {
        return Result.fail(
          new NotFoundError(`The file at ${relativePath} does not exist`, {
            translation: { message: 'storage.githubCdn.fileNotFound' },
          }),
        );
      }
      if (node.type !== 'file') {
        return Result.fail(
          new DirInsteadOfFile(`Expected a file at ${relativePath} but found a directory`, {
            translation: { message: 'storage.githubCdn.directoryInsteadOfFile' },
          }),
        );
      }

      let sha = node.hash ?? '';
      if (this.fetchMeta) {
        const contents = await this.getFileContents(relativePath);
        if (Result.isFailure(contents)) return Result.fail(contents.failure);
        sha = contents.success.sha;
      }
      return Result.succeed({ sha, createdAt: EPOCH, updatedAt: EPOCH });
    } catch (e) {
      return Result.fail(
        new InternalError(`Metadata lookup failed for ${relativePath}: ${e instanceof Error ? e.message : String(e)}`, {
          translation: { message: 'storage.githubCdn.unexpectedError' },
        }),
      );
    }
  }

  /** List immediate children of a directory. Empty array when the directory is missing or empty. */
  async listDirectory(relativePath: string): Promise<LaikaResult<GithubDirEntry[]>> {
    try {
      const parts = splitPath(relativePath);
      let nodes = await this.getTree();
      if (parts.length > 0) {
        const node = await this.findNode(relativePath);
        if (!node) return Result.succeed([]);
        if (node.type !== 'directory') {
          return Result.fail(
            new FileInsteadOfDir(`Expected a directory at ${relativePath} but found a file`, {
              translation: { message: 'storage.githubCdn.fileInsteadOfDirectory' },
            }),
          );
        }
        nodes = node.files;
      }
      const prefix = parts.length > 0 ? `${parts.join('/')}/` : '';
      return Result.succeed(
        nodes.map(n => ({
          name: n.name,
          path: `${prefix}${n.name}`,
          type: n.type === 'directory' ? 'dir' : 'file',
          sha: n.type === 'file' ? n.hash ?? '' : '',
        })),
      );
    } catch (e) {
      return Result.fail(
        new InternalError(
          `Directory listing failed for ${relativePath}: ${e instanceof Error ? e.message : String(e)}`,
          { translation: { message: 'storage.githubCdn.unexpectedError' } },
        ),
      );
    }
  }

  /** Distinguish file vs dir. Throws NotFoundError for missing paths (mirrors GithubDataSource). */
  async pathType(relativePath: string): Promise<'file' | 'dir'> {
    const node = await this.findNode(relativePath);
    if (!node) {
      throw new NotFoundError(`The path at ${relativePath} does not exist`, {
        translation: { message: 'storage.githubCdn.fileNotFound' },
      });
    }
    return node.type === 'directory' ? 'dir' : 'file';
  }
}
