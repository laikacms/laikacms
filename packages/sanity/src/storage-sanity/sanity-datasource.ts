import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  VersionMismatchError,
} from 'laikacms/core';

/** Sanity API version pin. The query + mutate endpoints both require a version. */
export const SANITY_API_VERSION = 'v2024-09-01';

/** `_type` values the repository uses to discriminate storage documents. */
export const TYPE_FILE = 'laikaObject' as const;
export const TYPE_FOLDER = 'laikaFolder' as const;

/** Auth for the Sanity API. */
export interface SanityAuth {
  readonly token?: string;
  /** Async token provider — called before every request so refreshes are transparent. */
  readonly tokenProvider?: () => string | Promise<string>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link SanityDataSource}. */
export interface SanityDataSourceOptions {
  readonly projectId: string;
  /** Sanity dataset (e.g. `production`). */
  readonly dataset: string;
  readonly auth: SanityAuth;
  /** Override the API base URL (handy for tests). Defaults to `https://<projectId>.api.sanity.io`. */
  readonly apiUrl?: string;
  /** Override the API version pin. Defaults to {@link SANITY_API_VERSION}. */
  readonly apiVersion?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /**
   * Override the `_id` derivation (defaults to a SHA-256 hex hash of the full
   * path). Use this if you want round-trippable ids — pass a function that
   * encodes the path safely for Sanity's `_id` constraints
   * (`^[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$`, no slashes, no leading hyphens).
   */
  readonly idFor?: (fullPath: string) => Promise<string> | string;
}

/** Minimal Sanity document shape — what the repository reads + writes. */
export interface SanityDocument {
  readonly _id: string;
  readonly _type: string;
  readonly _createdAt?: string;
  readonly _updatedAt?: string;
  readonly _rev?: string;
  readonly [key: string]: unknown;
}

/** A single mutation in a transactional `/mutate` batch. */
export type SanityMutation =
  | { create: SanityDocument }
  | { createOrReplace: SanityDocument }
  | { createIfNotExists: SanityDocument }
  | { delete: { id: string } }
  | { patch: { id: string; set?: Record<string, unknown>; ifRevisionID?: string } };

/** SHA-256 hex digest of `value` via Web Crypto. Stable, runtime-agnostic, slash-free. */
export const hashId = async (value: string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new InternalError('No SubtleCrypto available for SHA-256 id derivation');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { description?: string } };
    if (parsed.error?.description) detail = `: ${parsed.error.description}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Sanity authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Sanity access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Sanity resource not found: ${context}`));
    case 409:
      // Sanity returns 409 with `transactionFailedError` for `ifRevisionID` mismatches.
      return Result.fail(new VersionMismatchError(`Sanity transaction conflict for ${context}${detail}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Sanity rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Sanity service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Sanity returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Sanity returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [Sanity Content Lake API](https://www.sanity.io/docs/http-api)
 * over `fetch`. Two endpoints carry all the work:
 *
 * - `POST /data/query/<dataset>` runs a GROQ query. Body shape:
 *   `{query, params}`. Returns `{result, ms, query, ...}`.
 * - `POST /data/mutate/<dataset>` runs a transactional batch of mutations.
 *   Body shape: `{mutations: [...], returnDocuments?: true}`. Multiple
 *   creates / patches / deletes commit atomically in one round-trip — the
 *   sort of API Bitbucket also exposes for `POST /src`, but here it's
 *   first-class on every backend interaction.
 */
export class SanityDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: SanityAuth;
  private readonly apiUrl: string;
  private readonly apiVersion: string;
  private readonly dataset: string;
  private readonly idFn: (path: string) => Promise<string> | string;

  constructor(options: SanityDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via SanityDataSourceOptions.fetch');
    }
    if (!options.auth.token && !options.auth.tokenProvider) {
      throw new InternalError('SanityDataSource requires `auth.token` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? `https://${options.projectId}.api.sanity.io`).replace(/\/+$/, '');
    this.apiVersion = options.apiVersion ?? SANITY_API_VERSION;
    this.dataset = options.dataset;
    this.idFn = options.idFor ?? hashId;
  }

  /** Derive a slash-free document `_id` for a full storage path. */
  async idFor(path: string): Promise<string> {
    return await this.idFn(path);
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.token as string;
  }

  private async request(method: string, url: string, body?: unknown): Promise<Response> {
    const token = await this.accessToken();
    return this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(this.auth.headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /** Execute a GROQ query and return its `result` field. */
  async query<T = unknown>(
    query: string,
    params: Record<string, unknown> = {},
  ): Promise<LaikaResult<T>> {
    const url = `${this.apiUrl}/${this.apiVersion}/data/query/${encodeURIComponent(this.dataset)}`;
    let response: Response;
    try {
      response = await this.request('POST', url, { query, params });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Sanity unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'query');
    const data = (await response.json()) as { result: T };
    return Result.succeed(data.result);
  }

  /** Run a transactional batch of mutations. */
  async mutate(
    mutations: ReadonlyArray<SanityMutation>,
    options: { returnDocuments?: boolean } = {},
  ): Promise<LaikaResult<{ transactionId: string; results: Array<{ id: string; operation: string; document?: SanityDocument }> }>> {
    if (mutations.length === 0) {
      return Result.succeed({ transactionId: '', results: [] });
    }
    const url = `${this.apiUrl}/${this.apiVersion}/data/mutate/${encodeURIComponent(this.dataset)}`;
    let response: Response;
    try {
      response = await this.request('POST', url, {
        mutations,
        returnDocuments: options.returnDocuments,
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Sanity unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'mutate');
    const data = (await response.json()) as {
      transactionId: string;
      results?: Array<{ id: string; operation: string; document?: SanityDocument }>;
    };
    return Result.succeed({ transactionId: data.transactionId, results: data.results ?? [] });
  }
}
