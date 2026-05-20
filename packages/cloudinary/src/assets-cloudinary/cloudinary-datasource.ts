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

/** Cloudinary API credentials. */
export interface CloudinaryAuth {
  readonly cloudName: string;
  readonly apiKey: string;
  /** API secret — used only locally for signing, never sent on the wire. */
  readonly apiSecret: string;
}

/** Configuration for a {@link CloudinaryDataSource}. */
export interface CloudinaryDataSourceOptions {
  readonly auth: CloudinaryAuth;
  /** Custom `fetch` — handy for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /** Override the API base URL. Defaults to `https://api.cloudinary.com/v1_1`. */
  readonly apiUrl?: string;
  /** Override the delivery base URL. Defaults to `https://res.cloudinary.com`. */
  readonly deliveryUrl?: string;
  /**
   * SubtleCrypto-compatible source for SHA-1 signing. Defaults to
   * `globalThis.crypto.subtle`. Override only when running in environments
   * without Web Crypto (Cloudflare Workers and modern Node both have it).
   */
  readonly subtle?: SubtleCrypto;
}

/** A single Cloudinary resource as returned by the Admin API. */
export interface CloudinaryResource {
  readonly asset_id?: string;
  readonly public_id: string;
  readonly format: string;
  readonly resource_type: 'image' | 'video' | 'raw';
  readonly type: string;
  readonly version: number;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
  readonly created_at?: string;
  readonly url?: string;
  readonly secure_url?: string;
  readonly folder?: string;
  readonly etag?: string;
}

const DEFAULT_API_URL = 'https://api.cloudinary.com/v1_1';
const DEFAULT_DELIVERY_URL = 'https://res.cloudinary.com';

/** Base64-encode a UTF-8 string without depending on `Buffer`. */
const base64Utf8 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** Convert binary asset content into a data URL Cloudinary's upload endpoint accepts. */
const toDataUrl = async (
  content: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
  mimeType: string,
): Promise<string> => {
  const bytes = await collectBytes(content);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${btoa(binary)}`;
};

const collectBytes = async (
  content: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
): Promise<Uint8Array> => {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  // ReadableStream<Uint8Array>
  const reader = content.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
};

/**
 * Compute the Cloudinary signature for `params` — sort by key, concatenate as
 * `k1=v1&k2=v2…`, append the API secret, SHA-1 hex digest. Exported so the
 * shape can be unit-tested directly.
 */
export const signParams = async (
  params: Record<string, string | number>,
  apiSecret: string,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string> => {
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const payload = sorted.map(([k, v]) => `${k}=${v}`).join('&') + apiSecret;
  const digest = await subtle.digest('SHA-1', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

/** Map a Cloudinary HTTP status onto a Laika error, preserving the message when possible. */
const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) detail = `: ${parsed.error.message}`;
  } catch { /* swallow */ }
  switch (status) {
    case 400:
      // Cloudinary returns 400 for "resource already exists" on signed uploads with
      // overwrite=false. The message contains "already exists".
      if (/already exists/i.test(body)) {
        return Result.fail(new EntryAlreadyExistsError(`Cloudinary resource already exists: ${context}`));
      }
      return Result.fail(new InternalError(`Cloudinary rejected ${context}${detail}`));
    case 401:
      return Result.fail(new AuthenticationError(`Cloudinary authentication failed for ${context}`));
    case 403:
      return Result.fail(new ForbiddenError(`Cloudinary access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Cloudinary resource not found: ${context}`));
    case 420:
    case 429:
      return Result.fail(new TooManyRequestsError(`Cloudinary rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Cloudinary service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Cloudinary returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Cloudinary returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [Cloudinary Upload API](https://cloudinary.com/documentation/upload_images) and
 * [Admin API](https://cloudinary.com/documentation/admin_api) over `fetch`.
 *
 * Auth split:
 * - Upload API → **signed params** (SHA-1 digest of sorted `k=v` pairs + API secret).
 *   The API secret stays on the server — only the signature crosses the wire.
 * - Admin API → HTTP Basic with `api_key:api_secret`.
 *
 * Runtime-agnostic: depends only on `fetch` and `crypto.subtle` (Web Crypto), both
 * present on Node 22+, Bun, Deno, Cloudflare Workers, and modern browsers.
 */
export class CloudinaryDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: CloudinaryAuth;
  private readonly apiUrl: string;
  private readonly deliveryUrl: string;
  private readonly subtle: SubtleCrypto;

  constructor(options: CloudinaryDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via CloudinaryDataSourceOptions.fetch');
    }
    this.subtle = options.subtle ?? globalThis.crypto?.subtle;
    if (!this.subtle) {
      throw new InternalError('No SubtleCrypto available; pass one via CloudinaryDataSourceOptions.subtle');
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.deliveryUrl = (options.deliveryUrl ?? DEFAULT_DELIVERY_URL).replace(/\/+$/, '');
  }

  /** The configured cloud name — exposed for delivery-URL construction in the repository. */
  get cloudName(): string {
    return this.auth.cloudName;
  }

  /** The configured delivery URL — exposed for delivery-URL construction in the repository. */
  get deliveryBase(): string {
    return this.deliveryUrl;
  }

  // -----------------------------------------------------------------------
  // Upload API — signed
  // -----------------------------------------------------------------------

  /**
   * Upload an asset by public_id. `overwrite=true` replaces any existing
   * resource; `overwrite=false` returns an `EntryAlreadyExistsError`.
   */
  async upload(
    publicId: string,
    content: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
    mimeType: string,
    options: { overwrite?: boolean; folder?: string; resourceType?: 'image' | 'video' | 'raw' } = {},
  ): Promise<LaikaResult<CloudinaryResource>> {
    const resourceType = options.resourceType ?? 'image';
    const timestamp = Math.floor(Date.now() / 1000);

    // Parameters that get signed. Order does not matter — `signParams` sorts.
    const signable: Record<string, string | number> = {
      public_id: publicId,
      timestamp,
      overwrite: options.overwrite === false ? 'false' : 'true',
    };
    if (options.folder !== undefined) signable.folder = options.folder;

    const signature = await signParams(signable, this.auth.apiSecret, this.subtle);

    const dataUrl = await toDataUrl(content, mimeType);
    const form = new URLSearchParams();
    form.set('file', dataUrl);
    form.set('api_key', this.auth.apiKey);
    for (const [k, v] of Object.entries(signable)) form.set(k, String(v));
    form.set('signature', signature);

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.apiUrl}/${encodeURIComponent(this.auth.cloudName)}/${resourceType}/upload`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        },
      );
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Cloudinary unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), publicId);
    return Result.succeed((await response.json()) as CloudinaryResource);
  }

  // -----------------------------------------------------------------------
  // Admin API — HTTP Basic
  // -----------------------------------------------------------------------

  private adminUrl(path: string): string {
    return `${this.apiUrl}/${encodeURIComponent(this.auth.cloudName)}${path}`;
  }

  private async adminRequest(
    method: string,
    path: string,
    init?: { body?: unknown; headers?: Record<string, string>; queryString?: string },
  ): Promise<Response> {
    const url = `${this.adminUrl(path)}${init?.queryString ? `?${init.queryString}` : ''}`;
    const headers: Record<string, string> = {
      Authorization: `Basic ${base64Utf8(`${this.auth.apiKey}:${this.auth.apiSecret}`)}`,
      ...(init?.headers ?? {}),
    };
    let body: string | undefined;
    if (init?.body !== undefined) {
      body = JSON.stringify(init.body);
      headers['Content-Type'] ??= 'application/json';
    }
    return this.fetchImpl(url, { method, headers, body });
  }

  /** GET a single resource. Returns `null` on 404. */
  async getResource(
    publicId: string,
    resourceType: 'image' | 'video' | 'raw' = 'image',
  ): Promise<LaikaResult<CloudinaryResource | null>> {
    let response: Response;
    try {
      response = await this.adminRequest(
        'GET',
        `/resources/${resourceType}/upload/${encodeURIComponent(publicId)}`,
      );
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Cloudinary unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), publicId);
    return Result.succeed((await response.json()) as CloudinaryResource);
  }

  /**
   * List resources under a prefix. Pages through `next_cursor` until exhausted.
   * Use the empty prefix to list every resource in the account.
   */
  async listResources(
    prefix: string,
    resourceType: 'image' | 'video' | 'raw' = 'image',
  ): Promise<LaikaResult<CloudinaryResource[]>> {
    const out: CloudinaryResource[] = [];
    let nextCursor: string | undefined;
    do {
      const params = new URLSearchParams();
      params.set('type', 'upload');
      params.set('max_results', '500');
      if (prefix !== '') params.set('prefix', prefix);
      if (nextCursor) params.set('next_cursor', nextCursor);
      let response: Response;
      try {
        response = await this.adminRequest('GET', `/resources/${resourceType}`, {
          queryString: params.toString(),
        });
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Cloudinary unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), prefix || '<root>');
      const page = (await response.json()) as { resources: CloudinaryResource[]; next_cursor?: string };
      out.push(...page.resources);
      nextCursor = page.next_cursor;
    } while (nextCursor);
    return Result.succeed(out);
  }

  /** Delete multiple resources by public_id. Cloudinary returns per-id results. */
  async deleteResources(
    publicIds: readonly string[],
    resourceType: 'image' | 'video' | 'raw' = 'image',
  ): Promise<LaikaResult<Record<string, string>>> {
    if (publicIds.length === 0) return Result.succeed({});
    const params = new URLSearchParams();
    for (const id of publicIds) params.append('public_ids[]', id);
    let response: Response;
    try {
      response = await this.adminRequest('DELETE', `/resources/${resourceType}/upload`, {
        queryString: params.toString(),
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Cloudinary unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), publicIds.join(','));
    const result = (await response.json()) as { deleted: Record<string, string> };
    return Result.succeed(result.deleted ?? {});
  }

  /** List subfolders. Pass an empty string for top-level folders. */
  async listFolders(path: string): Promise<LaikaResult<Array<{ name: string; path: string }>>> {
    const target = path === '' ? '/folders' : `/folders/${encodeURIComponent(path)}`;
    let response: Response;
    try {
      response = await this.adminRequest('GET', target);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Cloudinary unreachable', { cause }));
    }
    if (response.status === 404) {
      return Result.fail(new NotFoundError(`Cloudinary folder not found: ${path || '<root>'}`));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), path || '<root>');
    const data = (await response.json()) as { folders: Array<{ name: string; path: string }> };
    return Result.succeed(data.folders);
  }

  /** Create a folder. Idempotent — a 409 / already-exists is treated as success. */
  async createFolder(path: string): Promise<LaikaResult<{ path: string }>> {
    let response: Response;
    try {
      response = await this.adminRequest('POST', `/folders/${encodeURIComponent(path)}`);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Cloudinary unreachable', { cause }));
    }
    if (response.ok || response.status === 409) return Result.succeed({ path });
    return errorForResponse(response.status, await safeText(response), path);
  }

  /** Delete a folder. Cloudinary refuses non-empty folders with a 409. */
  async deleteFolder(path: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.adminRequest('DELETE', `/folders/${encodeURIComponent(path)}`);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Cloudinary unreachable', { cause }));
    }
    if (response.ok || response.status === 404) return Result.succeed(undefined);
    return errorForResponse(response.status, await safeText(response), path);
  }
}
