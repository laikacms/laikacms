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

import { parseAnnotatedCsv, serializeLineProtocolPoint } from './wire-format.js';

// ---------------------------------------------------------------------------
// InfluxDB v2 HTTP data source
// ---------------------------------------------------------------------------
//
// InfluxDB v2 is a time-series database. Six traits set the wire shape
// apart from every prior backend in the Laika suite:
//
//   1. **Line protocol writes.** `POST /api/v2/write?org=…&bucket=…`
//      accepts a text body of newline-delimited points:
//
//          laika_storage,kind=file,parent=notes content="hi" 1700000000000000000
//
//      First textual line-by-line write format in the suite.
//
//   2. **Flux pipeline DSL for reads.** `POST /api/v2/query?org=…` with
//      a Flux source in the body:
//
//          from(bucket: "cms")
//            |> range(start: 0)
//            |> filter(fn: (r) => r._measurement == "laika_storage")
//            |> last()
//            |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
//
//      First functional pipeline DSL in the suite.
//
//   3. **Annotated CSV responses.** Reads come back as CSV with
//      `#datatype` / `#group` / `#default` annotation rows preceding
//      the column-name header. First CSV-on-the-wire backend.
//
//   4. **Tags vs fields distinction.** Tags are indexed (great for
//      filter); fields are arbitrary (great for content). First
//      indexed/unindexed column distinction in the suite.
//
//   5. **Nanosecond timestamps.** All write timestamps are
//      nanoseconds-since-epoch — sub-millisecond precision in the wire
//      format itself.
//
//   6. **`Authorization: Token …` auth.** Literally the word `Token`,
//      not `Bearer`. Distinct from every other auth header convention.

const DEFAULT_API_URL = 'http://localhost:8086';

export interface InfluxDbAuth {
  /** API token — provisioned at `https://<host>/orgs/<id>/load-data/tokens`. */
  readonly token: string;
}

export interface InfluxDbDataSourceOptions {
  readonly auth: InfluxDbAuth;
  /** Organisation name or ID. */
  readonly org: string;
  /** Bucket name. */
  readonly bucket: string;
  /** Base URL — default `http://localhost:8086`. */
  readonly url?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  const detail = body ? `: ${body.slice(0, 200)}` : '';
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`InfluxDB authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`InfluxDB access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`InfluxDB resource not found: ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`InfluxDB rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`InfluxDB returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`InfluxDB returned HTTP ${status} for ${context}${detail}`));
  }
};

/** Point shape for {@link InfluxDbDataSource.write}. */
export interface InfluxPoint {
  readonly measurement: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, string | number | boolean>>;
  /** Nanoseconds since epoch as a string. Default = now. */
  readonly timestampNs?: string;
}

/**
 * Predicate clause for {@link InfluxDbDataSource.delete}. Influx v2's
 * delete language supports only `=` equality between AND'd clauses. OR
 * is NOT reliably supported across versions.
 */
export interface InfluxDeletePredicate {
  /** Inclusive lower bound — RFC3339 string. Default `1970-01-01T00:00:00Z`. */
  readonly start?: string;
  /** Exclusive upper bound — RFC3339 string. Default `2099-12-31T23:59:59Z`. */
  readonly stop?: string;
  /** Predicate string — e.g. `_measurement="laika_storage" AND path="notes/hello.md"`. */
  readonly predicate: string;
}

/**
 * Talks the InfluxDB v2 HTTP API over `fetch`.
 *
 *  - {@link write} — POST `/api/v2/write` with line protocol body.
 *  - {@link query} — POST `/api/v2/query` with Flux source; returns
 *    annotated CSV parsed into data rows.
 *  - {@link delete} — POST `/api/v2/delete` with a JSON predicate body.
 *
 * The `?org` and `?bucket` parameters travel in the URL on every call
 * (except `query`, where `bucket` is part of the Flux source).
 */
export class InfluxDbDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: InfluxDbAuth;
  private readonly apiUrl: string;
  readonly org: string;
  readonly bucket: string;

  constructor(options: InfluxDbDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via InfluxDbDataSourceOptions.fetch',
      );
    }
    if (!options.auth?.token) throw new InternalError('InfluxDbDataSource requires `auth.token`');
    if (!options.org) throw new InternalError('InfluxDbDataSource requires `org`');
    if (!options.bucket) throw new InternalError('InfluxDbDataSource requires `bucket`');
    this.auth = options.auth;
    this.org = options.org;
    this.bucket = options.bucket;
    this.apiUrl = (options.url ?? DEFAULT_API_URL).replace(/\/+$/, '');
  }

  /**
   * Write one or more points via line protocol. The whole body is a
   * single HTTP request — multi-point writes go in as a multi-line
   * text body separated by `\n`.
   */
  async write(points: ReadonlyArray<InfluxPoint>): Promise<LaikaResult<void>> {
    if (points.length === 0) return Result.succeed(undefined);
    const nowNs = `${Date.now()}000000`; // millis → ns
    const body = points
      .map(p =>
        serializeLineProtocolPoint({
          measurement: p.measurement,
          tags: p.tags,
          fields: p.fields,
          timestampNs: p.timestampNs ?? nowNs,
        })
      )
      .join('\n');
    const url = `${this.apiUrl}/api/v2/write?org=${encodeURIComponent(this.org)}&bucket=${
      encodeURIComponent(this.bucket)
    }&precision=ns`;
    let response: Response;
    try {
      response = await this.request('POST', url, body, 'text/plain; charset=utf-8');
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('InfluxDB unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'write');
    return Result.succeed(undefined);
  }

  /**
   * Fire a Flux query. Returns the response parsed from annotated CSV
   * into an array of column-keyed data rows.
   */
  async query(flux: string): Promise<LaikaResult<Array<Record<string, string>>>> {
    const url = `${this.apiUrl}/api/v2/query?org=${encodeURIComponent(this.org)}`;
    let response: Response;
    try {
      response = await this.request('POST', url, flux, 'application/vnd.flux');
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('InfluxDB unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), flux.slice(0, 60));
    const csv = await response.text();
    try {
      return Result.succeed(parseAnnotatedCsv(csv));
    } catch (cause) {
      return Result.fail(
        new InternalError(
          `Failed to parse Influx CSV response: ${(cause as Error).message}`,
          { cause },
        ),
      );
    }
  }

  /**
   * Delete points matching a predicate. Influx v2's delete language is
   * limited to equality between AND'd clauses; for OR'd predicates,
   * issue multiple delete calls.
   */
  async delete(predicate: InfluxDeletePredicate): Promise<LaikaResult<void>> {
    const url = `${this.apiUrl}/api/v2/delete?org=${encodeURIComponent(this.org)}&bucket=${
      encodeURIComponent(this.bucket)
    }`;
    const body = JSON.stringify({
      start: predicate.start ?? '1970-01-01T00:00:00Z',
      stop: predicate.stop ?? '2099-12-31T23:59:59Z',
      predicate: predicate.predicate,
    });
    let response: Response;
    try {
      response = await this.request('POST', url, body, 'application/json');
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('InfluxDB unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), 'delete');
    return Result.succeed(undefined);
  }

  // ───────────────────────── plumbing ─────────────────────────

  private async request(
    method: string,
    url: string,
    body: string,
    contentType: string,
  ): Promise<Response> {
    return this.fetchImpl(url, {
      method,
      headers: {
        // **The defining auth-header quirk** — literally the word `Token`,
        // not `Bearer`. The data source treats this as the canonical form.
        Authorization: `Token ${this.auth.token}`,
        Accept: 'application/csv, text/csv, application/json',
        'Content-Type': contentType,
      },
      body,
    });
  }
}
