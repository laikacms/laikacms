import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  EntryAlreadyExistsError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from 'laikacms/core';

// ---------------------------------------------------------------------------
// Microsoft Graph / OneDrive
// ---------------------------------------------------------------------------
//
// Three architectural quirks of the Graph API set OneDrive apart from every
// other backend in the suite:
//
//   1. **Dual path / item-id addressing.** Every drive item is reachable two
//      ways — by path (`/me/drive/root:/notes/hello.md:`) and by opaque item
//      id (`/me/drive/items/{id}`). The trailing colon delimits the path
//      segment; subsequent `/content`, `/children`, `/createUploadSession`
//      etc. live past that colon. URL parsing is order-sensitive.
//
//   2. **`POST /$batch`.** Up to 20 requests in one HTTP round-trip; each
//      with its own method, URL, headers, and body; per-request results
//      come back in a `responses[]` array. Optional `dependsOn: [...]`
//      sequences them. **The 9th structurally distinct atomic-multi-write
//      mechanism in the Laika suite** — not transactional, but a single
//      HTTP round-trip regardless of N.
//
//   3. **Pre-signed `@microsoft.graph.downloadUrl`** in every file
//      metadata response. A short-lived (1h) public URL that fetches the
//      content with no auth header. Reads exploit this; the data source
//      returns it alongside the metadata so the repository can fetch
//      content from a CDN-style URL.

const DEFAULT_API_URL = 'https://graph.microsoft.com/v1.0';

export interface OneDriveAuth {
  /** Bearer token from Azure AD / Microsoft Entra. */
  readonly accessToken?: string;
  /** Async hook — overrides `accessToken` when present. Refresh-token
   *  handling lives outside this layer. */
  readonly tokenProvider?: () => string | Promise<string>;
  /** Extra headers merged onto every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface OneDriveDataSourceOptions {
  readonly auth: OneDriveAuth;
  /**
   * Drive path. Default `/me/drive` (delegated user). For app-only access
   * pass `/drives/{driveId}` or `/users/{userId}/drive`.
   */
  readonly drivePath?: string;
  /** Override the API base URL. Default `https://graph.microsoft.com/v1.0`. */
  readonly apiUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Shape of a single Microsoft Graph drive item as we surface it. */
export interface OneDriveItem {
  readonly id: string;
  readonly name: string;
  readonly parentReference?: { readonly path?: string };
  readonly file?: { readonly mimeType?: string };
  readonly folder?: { readonly childCount?: number };
  readonly size?: number;
  readonly createdDateTime?: string;
  readonly lastModifiedDateTime?: string;
  readonly eTag?: string;
  readonly cTag?: string;
  /** Short-lived pre-signed URL — fetch content without auth. */
  readonly '@microsoft.graph.downloadUrl'?: string;
}

/** One sub-request within a `POST /$batch` body. */
export interface BatchRequest {
  readonly id: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** URL relative to the API root, e.g. `/me/drive/root:/notes/a.md:`. */
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  /** IDs of prior sub-requests this one waits on. */
  readonly dependsOn?: readonly string[];
}

/** One sub-response in the `responses[]` array returned by `$batch`. */
export interface BatchResponse {
  readonly id: string;
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

/**
 * Map a Graph error response to a Laika error. The Graph error envelope
 * is `{error: {code, message, innerError?}}`.
 */
const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  let code = '';
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string, message?: string } };
    if (parsed.error) {
      code = parsed.error.code ?? '';
      if (parsed.error.message) detail = `: ${parsed.error.message}`;
    }
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Microsoft Graph authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Microsoft Graph access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Microsoft Graph not found: ${context}`));
    case 409:
      // `nameAlreadyExists` is the canonical conflict code on PUT/POST.
      return Result.fail(new EntryAlreadyExistsError(`Microsoft Graph conflict: ${code}${detail}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Microsoft Graph rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Microsoft Graph returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Microsoft Graph returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Encode a OneDrive path segment. OneDrive paths are URL-encoded with
 * one wrinkle: the `:` characters that terminate the `root:/...:`
 * segment are NOT encoded — they're path-syntactic.
 */
export const encodeDrivePath = (path: string): string => {
  const stripped = path.replace(/^\/+|\/+$/g, '');
  if (stripped === '') return '';
  return stripped.split('/').map(encodeURIComponent).join('/');
};

/**
 * Talks the [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/)
 * for OneDrive / SharePoint document libraries over `fetch`. Six
 * endpoints carry the work:
 *
 *  - `GET    {drive}/root:/<path>:`           — fetch item metadata
 *  - `GET    {drive}/root:/<path>:/children`  — list folder children
 *  - `PUT    {drive}/root:/<path>:/content`   — upload small file
 *  - `DELETE {drive}/root:/<path>:`           — delete item
 *  - `POST   {drive}/root:/<parent>:/children` body `{name, folder}` — create folder
 *  - `POST   /$batch` body `{requests: [...]}` — bulk endpoint; up to 20 sub-requests
 */
export class OneDriveDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: OneDriveAuth;
  private readonly apiUrl: string;
  private readonly drivePath: string;

  constructor(options: OneDriveDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via OneDriveDataSourceOptions.fetch',
      );
    }
    if (!options.auth.accessToken && !options.auth.tokenProvider) {
      throw new InternalError(
        'OneDriveDataSource requires `auth.accessToken` or `auth.tokenProvider`',
      );
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.drivePath = (options.drivePath ?? '/me/drive').replace(/\/+$/, '');
  }

  /** GET the item at `path`. Returns `null` on 404. */
  async getItem(path: string): Promise<LaikaResult<OneDriveItem | null>> {
    let response: Response;
    try {
      response = await this.request('GET', this.pathUrl(path));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Microsoft Graph unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), path || '<root>');
    return Result.succeed(await response.json() as OneDriveItem);
  }

  /** Fetch content bytes from a pre-signed `@microsoft.graph.downloadUrl`. */
  async getContent(downloadUrl: string): Promise<LaikaResult<string>> {
    let response: Response;
    try {
      // Pre-signed URL — no Authorization header (Graph rejects auth here).
      response = await this.fetchImpl(downloadUrl);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Microsoft Graph CDN unreachable', { cause }));
    }
    if (response.status === 404) return Result.fail(new NotFoundError('Pre-signed URL expired or revoked'));
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'download');
    return Result.succeed(await response.text());
  }

  /** List the immediate children of a folder. */
  async listChildren(path: string): Promise<LaikaResult<OneDriveItem[]>> {
    const url = this.pathUrl(path, '/children');
    let response: Response;
    try {
      response = await this.request('GET', url);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Microsoft Graph unreachable', { cause }));
    }
    if (response.status === 404) return Result.fail(new NotFoundError(`Folder not found: ${path || '<root>'}`));
    if (!response.ok) return errorForResponse(response.status, await safeText(response), path);
    const body = await response.json() as { value?: OneDriveItem[] };
    return Result.succeed(body.value ?? []);
  }

  /** PUT content to a file. Creates or overwrites. */
  async putContent(
    path: string,
    content: string,
    options: { contentType?: string, conflictBehavior?: 'replace' | 'fail' | 'rename' } = {},
  ): Promise<LaikaResult<OneDriveItem>> {
    // The conflictBehavior lives in the `@microsoft.graph.conflictBehavior`
    // query parameter on the URL.
    const conflict = options.conflictBehavior ?? 'replace';
    const url = `${this.pathUrl(path, '/content')}?@microsoft.graph.conflictBehavior=${conflict}`;
    let response: Response;
    try {
      response = await this.request('PUT', url, {
        body: content,
        headers: { 'Content-Type': options.contentType ?? 'application/octet-stream' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Microsoft Graph unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), path);
    return Result.succeed(await response.json() as OneDriveItem);
  }

  /** Create a folder under `parentPath`. */
  async createFolder(
    parentPath: string,
    name: string,
  ): Promise<LaikaResult<OneDriveItem>> {
    const url = this.pathUrl(parentPath, '/children');
    let response: Response;
    try {
      response = await this.request('POST', url, {
        body: JSON.stringify({
          name,
          folder: {},
          // `fail` if the folder already exists; the repository handles that.
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Microsoft Graph unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `${parentPath}/${name}`);
    return Result.succeed(await response.json() as OneDriveItem);
  }

  /**
   * Submit a batch — up to 20 sub-requests in one HTTP round-trip.
   * Returns one {@link BatchResponse} per sub-request in input order.
   *
   * **THIS is the distinguishing wire shape of the OneDrive backend.**
   * No other backend in the Laika suite has an endpoint that takes a
   * mixed-method list of HTTP requests with optional `dependsOn`
   * sequencing.
   */
  async batch(requests: readonly BatchRequest[]): Promise<LaikaResult<BatchResponse[]>> {
    if (requests.length === 0) return Result.succeed([]);
    if (requests.length > 20) {
      return Result.fail(
        new InternalError(
          `Microsoft Graph $batch caps at 20 sub-requests per call; got ${requests.length}`,
        ),
      );
    }
    let response: Response;
    try {
      response = await this.request('POST', '/$batch', {
        body: JSON.stringify({ requests }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Microsoft Graph unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), '$batch');
    const body = await response.json() as { responses?: BatchResponse[] };
    return Result.succeed(body.responses ?? []);
  }

  // ───────────────────────── plumbing ─────────────────────────

  /**
   * Build a path-addressed URL fragment of the form
   * `{drive}/root:/<encoded-path>:{suffix}`. When `suffix` is empty (eg.
   * for metadata GETs), the trailing colon is preserved — that's the
   * Microsoft Graph path-syntax convention.
   */
  private pathUrl(path: string, suffix: string = ''): string {
    const encoded = encodeDrivePath(path);
    if (encoded === '') {
      // Root has no path segment — just `/root` for the suffix-less case,
      // or `/root:{suffix}` if `suffix` starts with `:`. Most callers
      // pass a slash-prefixed suffix.
      return suffix === ''
        ? `${this.drivePath}/root`
        : `${this.drivePath}/root${suffix}`;
    }
    return `${this.drivePath}/root:/${encoded}:${suffix}`;
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.accessToken as string;
  }

  private async request(
    method: string,
    pathOrFullUrl: string,
    init?: { body?: BodyInit, headers?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.accessToken();
    const url = pathOrFullUrl.startsWith('http')
      ? pathOrFullUrl
      : `${this.apiUrl}${pathOrFullUrl}`;
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
