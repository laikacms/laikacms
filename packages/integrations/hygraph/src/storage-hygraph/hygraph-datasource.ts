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

/** Required Hygraph content-model names. The repository assumes these exist. */
export const TYPE_FILE_MODEL = 'LaikaObject' as const;
export const TYPE_FOLDER_MODEL = 'LaikaFolder' as const;

/** Hygraph publication stages. The repository reads/writes `DRAFT` by default. */
export type HygraphStage = 'DRAFT' | 'PUBLISHED';

/** Auth for the Hygraph GraphQL Content API. */
export interface HygraphAuth {
  /** Permanent Auth Token (PAT) — Bearer-prefixed automatically. */
  readonly token?: string;
  /** Async token provider — called before every request. */
  readonly tokenProvider?: () => string | Promise<string>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link HygraphDataSource}. */
export interface HygraphDataSourceOptions {
  /**
   * GraphQL endpoint URL for your Hygraph project — look this up in the
   * project settings; it'll look like `https://<region>.cdn.hygraph.com/content/<projectId>/master`
   * or `https://api-<region>.hygraph.com/v2/<projectId>/master`.
   */
  readonly endpoint: string;
  readonly auth: HygraphAuth;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /** Stage to read from and write to. Defaults to `DRAFT`. */
  readonly stage?: HygraphStage;
}

/** Standard GraphQL response envelope. */
export interface HygraphResponse<T> {
  readonly data?: T;
  readonly errors?: Array<{ message: string, path?: ReadonlyArray<string | number> }>;
}

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ message?: string }> };
    if (parsed.errors?.length) detail = `: ${parsed.errors.map(e => e.message).filter(Boolean).join('; ')}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Hygraph authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Hygraph access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Hygraph endpoint not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Hygraph rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Hygraph service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Hygraph returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Hygraph returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [Hygraph GraphQL Content API](https://hygraph.com/docs/api-reference/content-api/queries)
 * over `fetch`. Both reads and writes go through the single `endpoint` URL
 * with the standard GraphQL request envelope: `{query, variables,
 * operationName?}`.
 *
 * Hygraph is **schema-aware** — content models you define in the Hygraph
 * project show up as typed GraphQL fields. This repository assumes two
 * specific content models exist:
 *
 * - `LaikaObject` with `parent: String`, `name: String`, `path: String`,
 *   `extension: String`, `content: String`.
 * - `LaikaFolder` with `parent: String`, `name: String`, `path: String`.
 *
 * Provision both via the Hygraph Studio before pointing the repository at
 * the project. Without them, queries fail with "Cannot query field" GraphQL
 * errors that the repository surfaces as `InternalError`.
 */
export class HygraphDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: HygraphAuth;
  private readonly endpoint: string;
  readonly stage: HygraphStage;

  constructor(options: HygraphDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via HygraphDataSourceOptions.fetch');
    }
    if (!options.auth.token && !options.auth.tokenProvider) {
      throw new InternalError('HygraphDataSource requires `auth.token` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.stage = options.stage ?? 'DRAFT';
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.token as string;
  }

  /**
   * Submit a single GraphQL operation. `operationName` is included in the
   * envelope when present — it makes server-side logging clearer and lets
   * the test mock dispatch on the operation name without parsing the
   * query body.
   */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
    operationName?: string,
  ): Promise<LaikaResult<T>> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(this.auth.headers ?? {}),
        },
        body: JSON.stringify({ query, variables, operationName }),
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Hygraph unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), operationName ?? 'graphql');

    const envelope = (await response.json()) as HygraphResponse<T>;
    if (envelope.errors && envelope.errors.length > 0) {
      const msg = envelope.errors.map(e => e.message).join('; ');
      return Result.fail(new InternalError(`Hygraph GraphQL errors: ${msg}`));
    }
    if (envelope.data === undefined) {
      return Result.fail(new InternalError('Hygraph returned no data and no errors'));
    }
    return Result.succeed(envelope.data);
  }
}
