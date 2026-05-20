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
import { pathCombine, pathToSegments } from 'laikacms/storage';

import { parseMultiStatus, PROPFIND_BODY, type WebDavEntry } from './webdav-xml.js';

/** Credentials for the WebDAV server. Basic auth and Bearer tokens are mutually exclusive. */
export interface WebDavAuth {
  /** Username for HTTP Basic auth. */
  readonly username?: string;
  /** Password for HTTP Basic auth. */
  readonly password?: string;
  /** Bearer token; takes precedence over `username`/`password` when set. */
  readonly token?: string;
  /** Extra headers merged into every request (e.g. an `OCS-APIRequest` header for Nextcloud). */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link WebDavDataSource}. */
export interface WebDavConfig {
  /**
   * Absolute URL of the WebDAV collection that becomes the storage root, e.g.
   * `https://dav.example.com/remote.php/dav/files/alice`. A trailing slash is
   * optional.
   */
  readonly baseUrl: string;
  /** Optional credentials. Anonymous when omitted. */
  readonly auth?: WebDavAuth;
  /** Optional subpath under `baseUrl` treated as the root (e.g. `content`). */
  readonly basePath?: string;
  /** `fetch` implementation override — handy for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** A resolved resource, carrying its storage key relative to the configured root. */
export interface WebDavResource extends WebDavEntry {
  /** Decoded path relative to the storage root, including any file extension. */
  readonly key: string;
}

/** Base64-encode a UTF-8 string without depending on Node's `Buffer`. */
const base64Utf8 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** Map a non-2xx WebDAV HTTP status onto the matching `LaikaError`. */
const errorForStatus = (status: number, context: string): LaikaResult<never> => {
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`WebDAV authentication failed for ${context}`));
    case 403:
      return Result.fail(new ForbiddenError(`WebDAV access forbidden for ${context}`));
    case 404:
    case 410:
      return Result.fail(new NotFoundError(`WebDAV resource not found: ${context}`));
    case 405:
      return Result.fail(new ConflictError(`WebDAV method not allowed for ${context}`));
    case 409:
      return Result.fail(new ConflictError(`WebDAV conflict for ${context} (missing parent collection?)`));
    case 423:
      return Result.fail(new ConflictError(`WebDAV resource is locked: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`WebDAV server rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`WebDAV server unavailable for ${context}`));
    default:
      return Result.fail(new InternalError(`WebDAV request for ${context} failed with HTTP ${status}`));
  }
};

/**
 * Talks WebDAV (RFC 4918) over `fetch`. Owns URL construction, auth headers,
 * `multistatus` parsing and HTTP-status-to-`LaikaError` mapping, so the
 * repository can stay a thin orchestration layer.
 *
 * Keys handed to this datasource are POSIX-style paths relative to the storage
 * root, with no leading slash; the empty string addresses the root collection.
 */
export class WebDavDataSource {
  private readonly fetchImpl: typeof fetch;
  /** Root URL with no trailing slash. */
  private readonly rootUrl: string;
  /** Path segments of the server-side root, used to turn hrefs back into keys. */
  private readonly rootSegments: readonly string[];
  private readonly authHeaders: Readonly<Record<string, string>>;

  constructor(
    private readonly config: WebDavConfig,
    private readonly availableExtensions: readonly string[] = [],
  ) {
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via WebDavConfig.fetch');
    }

    const trimmed = config.baseUrl.replace(/\/+$/, '');
    const url = new URL(trimmed);
    const baseSegments = pathToSegments(url.pathname);
    const extraSegments = pathToSegments(config.basePath ?? '');
    this.rootSegments = [...baseSegments, ...extraSegments];
    url.pathname = '/' + this.rootSegments.map(encodeURIComponent).join('/');
    this.rootUrl = url.toString().replace(/\/+$/, '');

    this.authHeaders = this.buildAuthHeaders(config.auth);
  }

  private buildAuthHeaders(auth: WebDavAuth | undefined): Record<string, string> {
    const headers: Record<string, string> = { ...(auth?.headers ?? {}) };
    if (auth?.token) {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else if (auth?.username !== undefined) {
      headers['Authorization'] = `Basic ${base64Utf8(`${auth.username}:${auth.password ?? ''}`)}`;
    }
    return headers;
  }

  /** Build the absolute request URL for a root-relative key. */
  private urlFor(key: string): string {
    const segments = pathToSegments(key).map(encodeURIComponent);
    return segments.length === 0 ? this.rootUrl : `${this.rootUrl}/${segments.join('/')}`;
  }

  /** Turn a server href back into a root-relative key, or `undefined` when it is outside the root. */
  private keyFromHref(href: string): string | undefined {
    let path = href;
    try {
      // Absolute hrefs (`http://host/...`) and relative ones both parse here.
      path = new URL(href, this.rootUrl).pathname;
    } catch {
      // `href` was already a bare path.
    }
    const segments = pathToSegments(path);
    for (let i = 0; i < this.rootSegments.length; i++) {
      if (segments[i] !== this.rootSegments[i]) return undefined;
    }
    return segments.slice(this.rootSegments.length).join('/');
  }

  private async send(
    method: string,
    key: string,
    init?: { body?: string; headers?: Record<string, string> },
  ): Promise<Response> {
    return this.fetchImpl(this.urlFor(key), {
      method,
      headers: { ...this.authHeaders, ...(init?.headers ?? {}) },
      body: init?.body,
    });
  }

  /**
   * `PROPFIND` a single resource. Resolves to `null` when the server reports
   * `404`/`410` so callers can treat "absent" as a value rather than an error.
   */
  async statResource(key: string): Promise<LaikaResult<WebDavResource | null>> {
    let response: Response;
    try {
      response = await this.send('PROPFIND', key, {
        body: PROPFIND_BODY,
        headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError(`WebDAV server unreachable`, { cause }));
    }
    if (response.status === 404 || response.status === 410) return Result.succeed(null);
    if (response.status !== 207) return errorForStatus(response.status, key || '<root>');

    const entries = parseMultiStatus(await response.text());
    const entry = entries[0];
    if (!entry) return Result.succeed(null);
    return Result.succeed({ ...entry, key });
  }

  /**
   * Probe each registered file extension for `key` and return the first that
   * exists. Mirrors the filesystem datasource: keys are extension-free at the
   * repository boundary.
   */
  async resolveExisting(
    key: string,
  ): Promise<LaikaResult<{ extension: string; resource: WebDavResource } | null>> {
    for (const extension of this.availableExtensions) {
      const probe = await this.statResource(`${key}.${extension}`);
      if (Result.isFailure(probe)) return Result.fail(probe.failure);
      if (probe.success && !probe.success.isCollection) {
        return Result.succeed({ extension, resource: probe.success });
      }
    }
    return Result.succeed(null);
  }

  /** `GET` the raw body of `${key}.${extension}`. */
  async readFile(key: string, extension: string): Promise<LaikaResult<string>> {
    const target = `${key}.${extension}`;
    let response: Response;
    try {
      response = await this.send('GET', target);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('WebDAV server unreachable', { cause }));
    }
    if (!response.ok) return errorForStatus(response.status, target);
    return Result.succeed(await response.text());
  }

  /** `PUT` `content` to `${key}.${extension}`, creating any missing parent collections first. */
  async writeFile(key: string, extension: string, content: string): Promise<LaikaResult<void>> {
    const parent = pathToSegments(key).slice(0, -1).join('/');
    if (parent !== '') {
      const ensured = await this.ensureCollection(parent);
      if (Result.isFailure(ensured)) return ensured;
    }
    const target = `${key}.${extension}`;
    let response: Response;
    try {
      response = await this.send('PUT', target, {
        body: content,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('WebDAV server unreachable', { cause }));
    }
    if (!response.ok) return errorForStatus(response.status, target);
    return Result.succeed(undefined);
  }

  /** `DELETE` a resource (file or collection) addressed by its full key. */
  async deleteResource(key: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.send('DELETE', key);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('WebDAV server unreachable', { cause }));
    }
    if (!response.ok && response.status !== 404) return errorForStatus(response.status, key);
    return Result.succeed(undefined);
  }

  /**
   * `PROPFIND` with `Depth: 1` and return the direct children of `key`,
   * excluding the collection itself. A missing collection surfaces as a
   * {@link NotFoundError}.
   */
  async listChildren(key: string): Promise<LaikaResult<WebDavResource[]>> {
    let response: Response;
    try {
      response = await this.send('PROPFIND', key, {
        body: PROPFIND_BODY,
        headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('WebDAV server unreachable', { cause }));
    }
    if (response.status === 404 || response.status === 410) {
      return Result.fail(new NotFoundError(`WebDAV collection not found: ${key || '<root>'}`));
    }
    if (response.status !== 207) return errorForStatus(response.status, key || '<root>');

    const selfKey = pathToSegments(key).join('/');
    const children: WebDavResource[] = [];
    for (const entry of parseMultiStatus(await response.text())) {
      const childKey = this.keyFromHref(entry.href);
      if (childKey === undefined) continue;
      if (pathToSegments(childKey).join('/') === selfKey) continue; // skip the collection itself
      children.push({ ...entry, key: childKey });
    }
    return Result.succeed(children);
  }

  /**
   * Ensure the collection at `dirKey` and every ancestor exists, issuing
   * `MKCOL` top-down. A `405`/`301` on an existing collection is treated as
   * success — `MKCOL` is not idempotent across servers.
   */
  async ensureCollection(dirKey: string): Promise<LaikaResult<void>> {
    const segments = pathToSegments(dirKey);
    for (let depth = 1; depth <= segments.length; depth++) {
      const prefix = segments.slice(0, depth).join('/');
      let response: Response;
      try {
        response = await this.send('MKCOL', prefix);
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('WebDAV server unreachable', { cause }));
      }
      // 201 Created; 405/301 mean the collection already exists.
      if (response.ok || response.status === 405 || response.status === 301) continue;
      return errorForStatus(response.status, prefix);
    }
    return Result.succeed(undefined);
  }

  /** Combine the configured base path with a key — exposed for logging/diagnostics. */
  describe(key: string): string {
    return pathCombine(this.config.basePath ?? '', key);
  }
}
