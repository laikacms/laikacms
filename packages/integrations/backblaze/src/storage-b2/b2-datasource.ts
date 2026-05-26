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

// ---------------------------------------------------------------------------
// Backblaze B2 native API data source
// ---------------------------------------------------------------------------
//
// Backblaze B2 has an S3-compatible surface, but it also exposes a
// *native* API with significantly different wire conventions. Five
// traits set the native shape apart from every prior backend in the
// Laika suite:
//
//   1. **Two-phase upload pattern.** Every upload requires a separate
//      `b2_get_upload_url` call first, which returns a fresh
//      `uploadUrl` + `uploadAuthorizationToken` pair. The subsequent
//      `b2_upload_file` POSTs to *that* URL with *that* token — a
//      different endpoint and different token from the account-level
//      API. The data source acquires upload URLs on demand and falls
//      back to re-acquisition on 503.
//
//   2. **File versioning by default.** Every upload creates a new
//      version of the file; deletes need the `(fileName, fileId)`
//      tuple, not just the name. Distinct from S3-style overwrite-
//      in-place.
//
//   3. **Mandatory SHA-1 content verification.** Uploads MUST include
//      an `X-Bz-Content-Sha1` header matching the actual content.
//      Backblaze rejects mismatches at the storage layer. **First
//      backend in the suite with mandatory content-hash verification
//      on writes.** The data source computes SHA-1 via Web Crypto
//      before every upload.
//
//   4. **Bare `Authorization: <token>` header.** No `Bearer`, no
//      `Token`, just the token. **Distinct from every other auth
//      header convention in the suite.**
//
//   5. **POST-for-everything API.** Even reads of metadata use POST
//      with a JSON body (e.g. `POST /b2_list_file_names` body
//      `{bucketId, prefix}`). First backend with this convention —
//      every other backend uses GET for reads.

const DEFAULT_AUTHORIZE_URL = 'https://api.backblazeb2.com';

export interface B2Auth {
  /** Application key ID — `keyID` in the B2 dashboard. */
  readonly keyId: string;
  /** Application key — `applicationKey` in the B2 dashboard. */
  readonly applicationKey: string;
}

export interface B2DataSourceOptions {
  readonly auth: B2Auth;
  /** Bucket ID — required for upload/list/delete operations. */
  readonly bucketId: string;
  /** Bucket name — required for downloads (URL path component). */
  readonly bucketName: string;
  /**
   * Authorize URL — default `https://api.backblazeb2.com`. Only override
   * for testing. After the first `b2_authorize_account` call, the
   * returned `apiUrl` and `downloadUrl` are used for everything else.
   */
  readonly authorizeUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /**
   * Custom Web Crypto-compatible `subtle` implementation. Defaults to
   * `globalThis.crypto.subtle`. Tests can pass a deterministic shim.
   */
  readonly subtle?: SubtleCrypto;
}

/** Shape of an entry returned by `b2_list_file_names`. */
export interface B2FileVersion {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentLength: number;
  readonly contentSha1: string;
  readonly contentType: string;
  readonly uploadTimestamp: number;
  /** Custom file metadata; B2 supports arbitrary `X-Bz-Info-*` headers. */
  readonly fileInfo?: Record<string, string>;
}

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

/**
 * Parse a B2 error body. Backblaze returns errors as
 * `{status, code, message}` JSON; we extract `message` for the detail.
 */
const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { code?: string, message?: string };
    if (parsed.message) detail = `: ${parsed.code ?? ''} ${parsed.message}`.trim();
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Backblaze B2 authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Backblaze B2 access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Backblaze B2 not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Backblaze B2 rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Backblaze B2 returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Backblaze B2 returned HTTP ${status} for ${context}${detail}`));
  }
};

/** Cached account-level state after `b2_authorize_account`. */
interface AccountAuth {
  apiUrl: string;
  downloadUrl: string;
  authorizationToken: string;
}

/** Cached per-bucket upload URL (a token, an endpoint, an expiry hint). */
interface UploadUrl {
  uploadUrl: string;
  authorizationToken: string;
  /** Local timestamp when acquired — refresh after 24h. */
  acquiredAt: number;
}

/**
 * Compute SHA-1 over a UTF-8 string. Returns a 40-char hex digest.
 * Used to populate the `X-Bz-Content-Sha1` header on every upload.
 */
export const computeSha1Hex = async (
  content: string,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string> => {
  const bytes = new TextEncoder().encode(content);
  const hash = await subtle.digest('SHA-1', bytes);
  const hex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
};

/**
 * Talks the Backblaze B2 native API over `fetch`. Six endpoints carry
 * the work:
 *
 *  - `POST /b2api/v3/b2_authorize_account` — Basic auth with
 *    `keyId:applicationKey`. Returns `apiUrl`, `downloadUrl`,
 *    `authorizationToken`.
 *  - `POST <apiUrl>/b2api/v3/b2_get_upload_url` — fetch a per-upload
 *    URL + token (the **two-phase upload primitive**).
 *  - `POST <uploadUrl>` — actual file upload with `X-Bz-File-Name`,
 *    `X-Bz-Content-Sha1`, `Content-Type` headers.
 *  - `POST <apiUrl>/b2api/v3/b2_list_file_names` — list with prefix.
 *  - `POST <apiUrl>/b2api/v3/b2_delete_file_version` — delete by
 *    `(fileName, fileId)` tuple.
 *  - `GET <downloadUrl>/file/<bucketName>/<fileName>` — download
 *    file content (using account token).
 *
 * The data source caches the account auth across calls; upload URLs
 * are acquired per-upload (they expire after ~24h).
 */
export class B2DataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: B2Auth;
  private readonly authorizeUrl: string;
  private readonly subtle: SubtleCrypto;
  readonly bucketId: string;
  readonly bucketName: string;

  private accountAuth: AccountAuth | null = null;
  private uploadUrl: UploadUrl | null = null;

  constructor(options: B2DataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via B2DataSourceOptions.fetch',
      );
    }
    if (!options.auth?.keyId || !options.auth?.applicationKey) {
      throw new InternalError('B2DataSource requires `auth.keyId` and `auth.applicationKey`');
    }
    if (!options.bucketId) throw new InternalError('B2DataSource requires `bucketId`');
    if (!options.bucketName) throw new InternalError('B2DataSource requires `bucketName`');
    this.auth = options.auth;
    this.authorizeUrl = (options.authorizeUrl ?? DEFAULT_AUTHORIZE_URL).replace(/\/+$/, '');
    this.bucketId = options.bucketId;
    this.bucketName = options.bucketName;
    this.subtle = options.subtle ?? globalThis.crypto.subtle;
  }

  /** Force re-authorization. Useful when an account token expires (~24h). */
  invalidateAccountAuth(): void {
    this.accountAuth = null;
    this.uploadUrl = null;
  }

  // ───────────────────────── public API ─────────────────────────

  /** Upload a small file. Computes SHA-1 internally. */
  async uploadFile(
    fileName: string,
    content: string,
    contentType: string,
  ): Promise<LaikaResult<B2FileVersion>> {
    return this.uploadFileImpl(fileName, content, contentType, /* retried */ false);
  }

  /** Download file content by bucket-relative file name. */
  async downloadFile(fileName: string): Promise<LaikaResult<string>> {
    const account = await this.ensureAccountAuth();
    if (Result.isFailure(account)) return Result.fail(account.failure);
    const url = `${account.success.downloadUrl}/file/${encodeURIComponent(this.bucketName)}/${
      encodeURIComponent(fileName)
    }`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: account.success.authorizationToken },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Backblaze B2 unreachable', { cause }));
    }
    if (response.status === 404) return Result.fail(new NotFoundError(`B2 file not found: ${fileName}`));
    if (!response.ok) return errorForResponse(response.status, await safeText(response), fileName);
    return Result.succeed(await response.text());
  }

  /** List files by prefix. Returns the latest version per file name. */
  async listFileNames(options: {
    prefix?: string,
    maxFileCount?: number,
    startFileName?: string,
    delimiter?: string,
  } = {}): Promise<LaikaResult<{ files: B2FileVersion[], nextFileName: string | null }>> {
    const account = await this.ensureAccountAuth();
    if (Result.isFailure(account)) return Result.fail(account.failure);
    const body: Record<string, unknown> = { bucketId: this.bucketId };
    if (options.prefix !== undefined) body['prefix'] = options.prefix;
    if (options.maxFileCount !== undefined) body['maxFileCount'] = options.maxFileCount;
    if (options.startFileName !== undefined) body['startFileName'] = options.startFileName;
    if (options.delimiter !== undefined) body['delimiter'] = options.delimiter;

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${account.success.apiUrl}/b2api/v3/b2_list_file_names`,
        {
          method: 'POST',
          headers: {
            Authorization: account.success.authorizationToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Backblaze B2 unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'list');
    const parsed = await response.json() as { files: B2FileVersion[], nextFileName: string | null };
    return Result.succeed(parsed);
  }

  /** Delete a specific file version by (fileName, fileId) tuple. */
  async deleteFileVersion(
    fileName: string,
    fileId: string,
  ): Promise<LaikaResult<void>> {
    const account = await this.ensureAccountAuth();
    if (Result.isFailure(account)) return Result.fail(account.failure);
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${account.success.apiUrl}/b2api/v3/b2_delete_file_version`,
        {
          method: 'POST',
          headers: {
            Authorization: account.success.authorizationToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileName, fileId }),
        },
      );
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Backblaze B2 unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `delete ${fileName}`);
    return Result.succeed(undefined);
  }

  /** Get file info by fileId. Used after upload to surface metadata. */
  async getFileInfo(fileId: string): Promise<LaikaResult<B2FileVersion>> {
    const account = await this.ensureAccountAuth();
    if (Result.isFailure(account)) return Result.fail(account.failure);
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${account.success.apiUrl}/b2api/v3/b2_get_file_info`,
        {
          method: 'POST',
          headers: {
            Authorization: account.success.authorizationToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileId }),
        },
      );
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Backblaze B2 unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `getFileInfo ${fileId}`);
    return Result.succeed(await response.json() as B2FileVersion);
  }

  // ───────────────────────── plumbing ─────────────────────────

  /** Acquire and cache `b2_authorize_account` result. */
  private async ensureAccountAuth(): Promise<LaikaResult<AccountAuth>> {
    if (this.accountAuth) return Result.succeed(this.accountAuth);
    const basic = `Basic ${btoa(`${this.auth.keyId}:${this.auth.applicationKey}`)}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.authorizeUrl}/b2api/v3/b2_authorize_account`, {
        method: 'POST',
        headers: { Authorization: basic, Accept: 'application/json' },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Backblaze B2 authorize unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'authorize');
    const parsed = await response.json() as {
      apiInfo: { storageApi: { apiUrl: string, downloadUrl: string } },
      authorizationToken: string,
    };
    this.accountAuth = {
      apiUrl: parsed.apiInfo.storageApi.apiUrl.replace(/\/+$/, ''),
      downloadUrl: parsed.apiInfo.storageApi.downloadUrl.replace(/\/+$/, ''),
      authorizationToken: parsed.authorizationToken,
    };
    return Result.succeed(this.accountAuth);
  }

  /** Acquire and cache an upload URL. Cache expires after ~23h. */
  private async ensureUploadUrl(): Promise<LaikaResult<UploadUrl>> {
    const TWENTY_THREE_HOURS_MS = 23 * 60 * 60 * 1000;
    if (this.uploadUrl && (Date.now() - this.uploadUrl.acquiredAt) < TWENTY_THREE_HOURS_MS) {
      return Result.succeed(this.uploadUrl);
    }
    const account = await this.ensureAccountAuth();
    if (Result.isFailure(account)) return Result.fail(account.failure);

    let response: Response;
    try {
      response = await this.fetchImpl(`${account.success.apiUrl}/b2api/v3/b2_get_upload_url`, {
        method: 'POST',
        headers: {
          Authorization: account.success.authorizationToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bucketId: this.bucketId }),
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Backblaze B2 unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'get_upload_url');
    const parsed = await response.json() as { uploadUrl: string, authorizationToken: string };
    this.uploadUrl = {
      uploadUrl: parsed.uploadUrl,
      authorizationToken: parsed.authorizationToken,
      acquiredAt: Date.now(),
    };
    return Result.succeed(this.uploadUrl);
  }

  /**
   * The upload itself. Implements the SHA-1 verification step and the
   * one-shot retry on 503 (B2's signal that the upload URL is dead).
   */
  private async uploadFileImpl(
    fileName: string,
    content: string,
    contentType: string,
    retried: boolean,
  ): Promise<LaikaResult<B2FileVersion>> {
    const upload = await this.ensureUploadUrl();
    if (Result.isFailure(upload)) return Result.fail(upload.failure);

    const sha1 = await computeSha1Hex(content, this.subtle);

    let response: Response;
    try {
      response = await this.fetchImpl(upload.success.uploadUrl, {
        method: 'POST',
        headers: {
          // **The defining auth-header quirk.** No `Bearer` or `Token` prefix.
          Authorization: upload.success.authorizationToken,
          'X-Bz-File-Name': encodeURIComponent(fileName),
          'Content-Type': contentType,
          // **Mandatory** — B2 rejects on mismatch.
          'X-Bz-Content-Sha1': sha1,
          'Content-Length': String(new TextEncoder().encode(content).byteLength),
        },
        body: content,
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Backblaze B2 unreachable', { cause }));
    }
    if (response.status === 503 && !retried) {
      // B2's convention: 503 means the upload URL is stale. Discard and
      // get a fresh one, then retry once.
      this.uploadUrl = null;
      return this.uploadFileImpl(fileName, content, contentType, true);
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), fileName);
    return Result.succeed(await response.json() as B2FileVersion);
  }
}
