import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  ForbiddenError,
  InternalError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from 'laikacms/core';

/** Configuration for an {@link UpstashRedisDataSource}. */
export interface UpstashRedisDataSourceOptions {
  /**
   * Upstash REST URL — looks like `https://<region>-<name>-<n>.upstash.io`.
   * Trailing slashes are stripped automatically.
   */
  readonly url: string;
  /** Upstash REST token. Sent as a Bearer token. */
  readonly token: string;
  /** Optional fetch override — handy for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Result shape returned by the Upstash REST API for a single command. */
export interface RedisCommandResult<T = unknown> {
  readonly result?: T;
  readonly error?: string;
}

/**
 * Talks the [Upstash Redis REST API](https://upstash.com/docs/redis/features/restapi)
 * over `fetch`. Submits commands as JSON arrays (`["GET", "key"]`), reads
 * the `{ result | error }` envelope, and batches multi-key reads through
 * the `/pipeline` endpoint when it would otherwise issue many round-trips.
 *
 * The whole datasource is intentionally generic — it does not know anything
 * about the storage layout. The repository layer builds Redis keys and
 * decides which commands to invoke.
 */
export class UpstashRedisDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly headers: Readonly<Record<string, string>>;

  constructor(options: UpstashRedisDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via UpstashRedisDataSourceOptions.fetch',
      );
    }
    this.baseUrl = options.url.replace(/\/+$/, '');
    this.headers = {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    };
  }

  /** Run a single Redis command, return the unwrapped `result` field. */
  async run<T = unknown>(command: readonly (string | number)[]): Promise<LaikaResult<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(command),
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Upstash Redis unreachable', { cause }));
    }
    if (!response.ok) return this.mapStatus(response.status, command.join(' '));

    const data = (await response.json()) as RedisCommandResult<T>;
    if (data.error) {
      return Result.fail(new InternalError(`Upstash Redis error for ${command[0]}: ${data.error}`));
    }
    return Result.succeed(data.result as T);
  }

  /**
   * Pipeline multiple commands through the `/pipeline` endpoint — Upstash
   * returns one envelope per command, in order. Failures in one command do
   * not abort the others (each gets its own `{ result | error }`).
   */
  async pipeline<T = unknown>(
    commands: ReadonlyArray<readonly (string | number)[]>,
  ): Promise<LaikaResult<RedisCommandResult<T>[]>> {
    if (commands.length === 0) return Result.succeed([]);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/pipeline`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(commands),
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Upstash Redis unreachable', { cause }));
    }
    if (!response.ok) return this.mapStatus(response.status, 'pipeline');
    const data = (await response.json()) as RedisCommandResult<T>[];
    return Result.succeed(data);
  }

  /**
   * Iterate `SCAN` until the cursor wraps back to `0`. Returns every key
   * matching `pattern`. The default `count` of 500 is a hint to Redis, not
   * a hard limit on returned keys.
   */
  async scanAll(pattern: string, count = 500): Promise<LaikaResult<string[]>> {
    const seen: string[] = [];
    let cursor: string | number = 0;
    while (true) {
      const stepResult = await this.run<[string, string[]]>([
        'SCAN',
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        count,
      ]);
      if (Result.isFailure(stepResult)) return Result.fail(stepResult.failure);
      const tuple = stepResult.success;
      const nextCursor: string = tuple[0];
      const keys: string[] = tuple[1];
      if (keys && keys.length > 0) seen.push(...keys);
      if (nextCursor === '0' || nextCursor === '') break;
      cursor = nextCursor;
    }
    return Result.succeed(seen);
  }

  private mapStatus<T>(status: number, context: string): LaikaResult<T> {
    switch (status) {
      case 401:
        return Result.fail(new AuthenticationError(`Upstash authentication failed for ${context}`));
      case 403:
        return Result.fail(new ForbiddenError(`Upstash access forbidden for ${context}`));
      case 429:
        return Result.fail(new TooManyRequestsError(`Upstash rate-limited request for ${context}`));
      case 503:
        return Result.fail(new ServiceUnavailableError(`Upstash service unavailable for ${context}`));
      default:
        if (status >= 500) {
          return Result.fail(new ServiceUnavailableError(`Upstash returned HTTP ${status} for ${context}`));
        }
        return Result.fail(new InternalError(`Upstash returned HTTP ${status} for ${context}`));
    }
  }
}
