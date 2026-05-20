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

const DEFAULT_API_URL = 'https://api.cloudflare.com/client/v4';

/** Auth for the Cloudflare Images API. Same Bearer-token shape as D1. */
export interface CloudflareImagesAuth {
  readonly apiToken?: string;
  readonly tokenProvider?: () => string | Promise<string>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link CloudflareImagesDataSource}. */
export interface CloudflareImagesDataSourceOptions {
  readonly auth: CloudflareImagesAuth;
  /** Cloudflare account id (the value visible in the dashboard URL). */
  readonly accountId: string;
  /** Override the API base URL. Defaults to `https://api.cloudflare.com/client/v4`. */
  readonly apiUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Subset of the Cloudflare Images image-object shape we read. */
export interface CloudflareImageResource {
  readonly id: string;
  readonly filename?: string;
  readonly uploaded: string;
  readonly requireSignedURLs?: boolean;
  /** Delivery URLs preformatted by Cloudflare — one per account-level variant. */
  readonly variants?: string[];
  readonly meta?: Record<string, string>;
}

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ message?: string }> };
    if (parsed.errors?.length) detail = `: ${parsed.errors.map(e => e.message).filter(Boolean).join('; ')}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Cloudflare Images authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Cloudflare Images access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Cloudflare Images resource not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Cloudflare Images rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Cloudflare Images service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Cloudflare Images returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Cloudflare Images returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [Cloudflare Images API](https://developers.cloudflare.com/api/operations/cloudflare-images-list-images)
 * over `fetch`. Three endpoints carry the work:
 *
 * - `POST /accounts/{id}/images/v1` — multipart upload. The `id` form
 *   field doubles as the storage key when present (Cloudflare otherwise
 *   auto-generates a UUID).
 * - `GET / DELETE /accounts/{id}/images/v1/{id}` — single-image CRUD.
 * - `GET /accounts/{id}/images/v1?page=…` — paginated listing. Cloudflare
 *   Images has no native folder / metadata-filter surface; the repository
 *   filters listings client-side.
 *
 * Cloudflare's envelope shape — `{result, success, errors, messages}` — is
 * unwrapped here so callers see the same `Result<X, LaikaError>` shape as
 * everywhere else in the suite.
 */
export class CloudflareImagesDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: CloudflareImagesAuth;
  private readonly apiUrl: string;
  private readonly accountId: string;

  constructor(options: CloudflareImagesDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via CloudflareImagesDataSourceOptions.fetch',
      );
    }
    if (!options.auth.apiToken && !options.auth.tokenProvider) {
      throw new InternalError(
        'CloudflareImagesDataSource requires `auth.apiToken` or `auth.tokenProvider`',
      );
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.accountId = options.accountId;
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.apiToken as string;
  }

  private imagesUrl(rest = ''): string {
    return `${this.apiUrl}/accounts/${encodeURIComponent(this.accountId)}/images/v1${rest}`;
  }

  /** Upload a binary asset. Setting `id` makes the key deterministic. */
  async upload(
    id: string,
    content: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
    options: { filename?: string; metadata?: Record<string, string>; mimeType?: string } = {},
  ): Promise<LaikaResult<CloudflareImageResource>> {
    const form = new FormData();
    // Cast widens `Uint8Array<ArrayBufferLike>` to `BlobPart` — structurally
    // identical, but the TS lib types are strict about `SharedArrayBuffer`
    // vs `ArrayBuffer` and we know which side we're on.
    const blob = content instanceof Uint8Array || content instanceof ArrayBuffer
      ? new Blob([content as unknown as BlobPart], { type: options.mimeType })
      : await new Response(content).blob();
    form.set('file', blob, options.filename ?? id);
    form.set('id', id);
    if (options.metadata) form.set('metadata', JSON.stringify(options.metadata));

    let response: Response;
    try {
      response = await this.request('POST', this.imagesUrl(), { body: form });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Cloudflare Images unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), id);
    return this.unwrapEnvelope(await response.json());
  }

  /** Get a single image's metadata + variant URLs. `null` on 404. */
  async getImage(id: string): Promise<LaikaResult<CloudflareImageResource | null>> {
    let response: Response;
    try {
      response = await this.request('GET', this.imagesUrl(`/${encodeURIComponent(id)}`));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Cloudflare Images unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), id);
    return this.unwrapEnvelope<CloudflareImageResource | null>(await response.json());
  }

  /** Delete an image by id. 404 is treated as success. */
  async deleteImage(id: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('DELETE', this.imagesUrl(`/${encodeURIComponent(id)}`));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Cloudflare Images unreachable', { cause }));
    }
    if (response.ok || response.status === 404) return Result.succeed(undefined);
    return errorForResponse(response.status, await safeText(response), id);
  }

  /**
   * List every image in the account. Cloudflare Images has no metadata
   * filter; pages through `?page=N&per_page=100` until exhausted. The
   * repository filters by id prefix client-side.
   */
  async listImages(): Promise<LaikaResult<CloudflareImageResource[]>> {
    const out: CloudflareImageResource[] = [];
    let page = 1;
    while (true) {
      const url = new URL(this.imagesUrl());
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', '100');

      let response: Response;
      try {
        response = await this.request('GET', url.toString());
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Cloudflare Images unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), 'list');
      const envelope = await response.json() as {
        success: boolean;
        result?: { images?: CloudflareImageResource[] };
        errors?: Array<{ message?: string }>;
      };
      if (!envelope.success) {
        const message = envelope.errors?.map(e => e.message).filter(Boolean).join('; ') ?? 'unknown';
        return Result.fail(new InternalError(`Cloudflare Images list failed: ${message}`));
      }
      const images = envelope.result?.images ?? [];
      out.push(...images);
      if (images.length < 100) break;
      page += 1;
    }
    return Result.succeed(out);
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: BodyInit; headers?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.accessToken();
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

  /** Unwrap Cloudflare's `{result, success, errors, messages}` envelope. */
  private unwrapEnvelope<T>(envelope: unknown): LaikaResult<T> {
    const e = envelope as {
      success: boolean;
      result?: T;
      errors?: Array<{ message?: string }>;
    };
    if (!e.success) {
      const message = e.errors?.map(err => err.message).filter(Boolean).join('; ') ?? 'unknown';
      return Result.fail(new InternalError(`Cloudflare Images: ${message}`));
    }
    return Result.succeed(e.result as T);
  }
}
