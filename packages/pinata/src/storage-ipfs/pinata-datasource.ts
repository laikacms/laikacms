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

const DEFAULT_API_URL = 'https://api.pinata.cloud';
const DEFAULT_GATEWAY_URL = 'https://gateway.pinata.cloud/ipfs';

/** Auth for the Pinata API. Currently only JWT Bearer tokens are supported. */
export interface PinataAuth {
  /** Pinata JWT token (Bearer). */
  readonly token?: string;
  /** Async token provider — called before every request. */
  readonly tokenProvider?: () => string | Promise<string>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link PinataDataSource}. */
export interface PinataDataSourceOptions {
  readonly auth: PinataAuth;
  /** Override the API base URL. Defaults to `https://api.pinata.cloud`. */
  readonly apiUrl?: string;
  /**
   * Override the gateway base URL — typically your dedicated Pinata gateway
   * for higher throughput and SLA. Defaults to the public
   * `https://gateway.pinata.cloud/ipfs`.
   */
  readonly gatewayUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Per-pin metadata `keyvalues` shape used by this repository. */
export interface PinataKeyValues {
  readonly type: 'file' | 'folder';
  readonly parent: string;
  readonly extension?: string;
  readonly path: string;
}

/** A single row from `GET /data/pinList`. */
export interface PinataPinRow {
  readonly id: string;
  readonly ipfs_pin_hash: string;
  readonly size: number;
  readonly date_pinned: string;
  readonly metadata: {
    readonly name: string;
    readonly keyvalues: PinataKeyValues & Record<string, unknown>;
  };
}

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: string | { reason?: string } };
    const msg = typeof parsed.error === 'string'
      ? parsed.error
      : parsed.error?.reason;
    if (msg) detail = `: ${msg}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Pinata authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Pinata access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Pinata resource not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Pinata rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Pinata service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Pinata returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Pinata returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [Pinata API](https://docs.pinata.cloud/api-reference/) over
 * `fetch`. Two surfaces are exercised:
 *
 * 1. **Pinning API** (`api.pinata.cloud`) — `POST /pinning/pinFileToIPFS`
 *    uploads content and returns a CID; `DELETE /pinning/unpin/<CID>`
 *    removes a pin; `GET /data/pinList` searches pinned entries by
 *    metadata.
 * 2. **Dedicated gateway** (`gateway.pinata.cloud/ipfs/<CID>`) — fetches
 *    content for retrieval.
 *
 * Mutability story: **CIDs are content hashes**, so every write produces a
 * new CID. The repository layer above keeps the mutable path → latest-CID
 * mapping in Pinata's `metadata.name` and `metadata.keyvalues` fields and
 * searches over them at read time. Old CIDs get unpinned after the new pin
 * lands — effectively a copy-on-write with a brief window of overlap.
 */
export class PinataDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: PinataAuth;
  private readonly apiUrl: string;
  /** Gateway base URL — exposed so the repository can build retrieval URLs. */
  readonly gatewayUrl: string;

  constructor(options: PinataDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via PinataDataSourceOptions.fetch');
    }
    if (!options.auth.token && !options.auth.tokenProvider) {
      throw new InternalError('PinataDataSource requires `auth.token` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.gatewayUrl = (options.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.token as string;
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: BodyInit; headers?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(this.auth.headers ?? {}),
      ...(init?.headers ?? {}),
    };
    return this.fetchImpl(url, { method, headers, body: init?.body });
  }

  /**
   * Pin a UTF-8 string as a file. Returns the assigned CID. The
   * `metadata.name` becomes the searchable path key; `metadata.keyvalues`
   * carry the structural data (`type`, `parent`, `extension`).
   */
  async pinFile(
    content: string,
    metadata: { name: string; keyvalues: PinataKeyValues },
  ): Promise<LaikaResult<{ cid: string; size: number; pinnedAt: string }>> {
    const form = new FormData();
    form.set('file', new Blob([content]), metadata.name);
    form.set('pinataMetadata', JSON.stringify({
      name: metadata.name,
      keyvalues: metadata.keyvalues,
    }));

    let response: Response;
    try {
      response = await this.request('POST', `${this.apiUrl}/pinning/pinFileToIPFS`, { body: form });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Pinata unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), metadata.name);
    const data = (await response.json()) as { IpfsHash: string; PinSize: number; Timestamp: string };
    return Result.succeed({ cid: data.IpfsHash, size: data.PinSize, pinnedAt: data.Timestamp });
  }

  /** Unpin a CID. A 404 is treated as success — the caller wanted it gone. */
  async unpin(cid: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('DELETE', `${this.apiUrl}/pinning/unpin/${encodeURIComponent(cid)}`);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Pinata unreachable', { cause }));
    }
    if (response.ok || response.status === 404) return Result.succeed(undefined);
    return errorForResponse(response.status, await safeText(response), cid);
  }

  /**
   * Search pinned entries. The `query` parameters mirror Pinata's
   * `pinList` filter shape — `metadata[name]`, `metadata[keyvalues]`, etc.
   * Drains every page via the standard `pageOffset` / `pageLimit` cursor.
   */
  async searchPins(query: Record<string, string>): Promise<LaikaResult<PinataPinRow[]>> {
    const all: PinataPinRow[] = [];
    let pageOffset = 0;
    const pageLimit = 1000;
    while (true) {
      const url = new URL(`${this.apiUrl}/data/pinList`);
      url.searchParams.set('status', 'pinned');
      url.searchParams.set('pageLimit', String(pageLimit));
      url.searchParams.set('pageOffset', String(pageOffset));
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

      let response: Response;
      try {
        response = await this.request('GET', url.toString());
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Pinata unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), 'pinList');
      const data = (await response.json()) as { rows?: PinataPinRow[]; count?: number };
      const rows = data.rows ?? [];
      all.push(...rows);
      if (rows.length < pageLimit) break;
      pageOffset += rows.length;
    }
    return Result.succeed(all);
  }

  /** Fetch a pinned file's content via the configured gateway. */
  async fetchContent(cid: string): Promise<LaikaResult<string>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.gatewayUrl}/${encodeURIComponent(cid)}`);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Pinata gateway unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), cid);
    return Result.succeed(await response.text());
  }
}
