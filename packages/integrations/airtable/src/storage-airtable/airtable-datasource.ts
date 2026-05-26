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

const DEFAULT_API_URL = 'https://api.airtable.com/v0';

/** Airtable caps every batch endpoint (create/update/delete) at 10 records. */
export const AIRTABLE_BATCH_LIMIT = 10;

/** Auth for the Airtable REST API. */
export interface AirtableAuth {
  /** Personal Access Token (PAT) — Bearer-prefixed automatically. */
  readonly token?: string;
  /** Async token provider — called before every request. */
  readonly tokenProvider?: () => string | Promise<string>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for an {@link AirtableDataSource}. */
export interface AirtableDataSourceOptions {
  readonly baseId: string;
  /** Table name OR table id. Both work; ids start with `tbl…` and are immutable. */
  readonly tableName: string;
  readonly auth: AirtableAuth;
  /** Override the API base URL. Defaults to `https://api.airtable.com/v0`. */
  readonly apiUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** A single Airtable record. */
export interface AirtableRecord<F extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly createdTime?: string;
  readonly fields: F;
}

/**
 * Escape a literal string for use inside an Airtable filter formula.
 * Airtable formulas double-quote string literals; embedded `"` characters
 * must be doubled. (No backslash escaping, just `""`.)
 */
export const escapeAirtableString = (value: string): string => `"${value.replace(/"/g, '""')}"`;

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
    const parsed = JSON.parse(body) as { error?: { message?: string, type?: string } | string };
    if (typeof parsed.error === 'string') detail = `: ${parsed.error}`;
    else if (parsed.error?.message) detail = `: ${parsed.error.message}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Airtable authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Airtable access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Airtable resource not found: ${context}`));
    case 422:
      return Result.fail(new InternalError(`Airtable rejected ${context}${detail}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Airtable rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Airtable service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Airtable returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Airtable returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the [Airtable Web API](https://airtable.com/developers/web/api) over
 * `fetch`. Two Airtable-shaped quirks the data source handles:
 *
 * 1. **`filterByFormula`** — Airtable's own formula language for query
 *    predicates. Field names in `{Braces}`, string literals in
 *    `"double quotes"`, embedded `"` doubled. `escapeAirtableString` is
 *    exported so callers can build their own predicates safely.
 * 2. **10-record batch cap** — `POST` / `PATCH` / `DELETE` all reject more
 *    than {@link AIRTABLE_BATCH_LIMIT} records per call. This data source
 *    chunks larger batches transparently so the repository can pretend the
 *    cap doesn't exist.
 *
 * Pagination drains every page via Airtable's `offset` cursor before
 * returning.
 */
export class AirtableDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: AirtableAuth;
  private readonly apiUrl: string;
  private readonly baseId: string;
  private readonly tableName: string;

  constructor(options: AirtableDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via AirtableDataSourceOptions.fetch');
    }
    if (!options.auth.token && !options.auth.tokenProvider) {
      throw new InternalError('AirtableDataSource requires `auth.token` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.baseId = options.baseId;
    this.tableName = options.tableName;
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.token as string;
  }

  private tableUrl(): string {
    return `${this.apiUrl}/${encodeURIComponent(this.baseId)}/${encodeURIComponent(this.tableName)}`;
  }

  private async request(method: string, url: string, body?: unknown): Promise<Response> {
    const token = await this.accessToken();
    return this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.auth.headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Run a `filterByFormula` query and return every matching record. Drains
   * Airtable's `offset` cursor until exhausted.
   */
  async list<F extends Record<string, unknown> = Record<string, unknown>>(
    filterByFormula: string,
    options: { sort?: Array<{ field: string, direction?: 'asc' | 'desc' }>, pageSize?: number } = {},
  ): Promise<LaikaResult<AirtableRecord<F>[]>> {
    const all: AirtableRecord<F>[] = [];
    let offset: string | undefined;
    do {
      const url = new URL(this.tableUrl());
      if (filterByFormula !== '') url.searchParams.set('filterByFormula', filterByFormula);
      url.searchParams.set('pageSize', String(options.pageSize ?? 100));
      if (options.sort) {
        options.sort.forEach((s, i) => {
          url.searchParams.set(`sort[${i}][field]`, s.field);
          if (s.direction) url.searchParams.set(`sort[${i}][direction]`, s.direction);
        });
      }
      if (offset) url.searchParams.set('offset', offset);

      let response: Response;
      try {
        response = await this.request('GET', url.toString());
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Airtable unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), 'list');
      const data = (await response.json()) as {
        records: AirtableRecord<F>[],
        offset?: string,
      };
      all.push(...data.records);
      offset = data.offset;
    } while (offset);
    return Result.succeed(all);
  }

  /**
   * Create records. Chunks the input list so each HTTP call carries at
   * most {@link AIRTABLE_BATCH_LIMIT} records — Airtable rejects bigger
   * batches with HTTP 422.
   */
  async create<F extends Record<string, unknown>>(
    records: ReadonlyArray<{ fields: F }>,
  ): Promise<LaikaResult<AirtableRecord<F>[]>> {
    const out: AirtableRecord<F>[] = [];
    for (let i = 0; i < records.length; i += AIRTABLE_BATCH_LIMIT) {
      const chunk = records.slice(i, i + AIRTABLE_BATCH_LIMIT);
      let response: Response;
      try {
        response = await this.request('POST', this.tableUrl(), { records: chunk, typecast: false });
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Airtable unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), 'create');
      const data = (await response.json()) as { records: AirtableRecord<F>[] };
      out.push(...data.records);
    }
    return Result.succeed(out);
  }

  /** Update records by id. Same 10-record cap; same chunking strategy. */
  async update<F extends Record<string, unknown>>(
    records: ReadonlyArray<{ id: string, fields: Partial<F> }>,
  ): Promise<LaikaResult<AirtableRecord<F>[]>> {
    const out: AirtableRecord<F>[] = [];
    for (let i = 0; i < records.length; i += AIRTABLE_BATCH_LIMIT) {
      const chunk = records.slice(i, i + AIRTABLE_BATCH_LIMIT);
      let response: Response;
      try {
        response = await this.request('PATCH', this.tableUrl(), { records: chunk });
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Airtable unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), 'update');
      const data = (await response.json()) as { records: AirtableRecord<F>[] };
      out.push(...data.records);
    }
    return Result.succeed(out);
  }

  /** Delete records by id. Returns ids that were actually deleted. */
  async delete(ids: ReadonlyArray<string>): Promise<LaikaResult<string[]>> {
    if (ids.length === 0) return Result.succeed([]);
    const deleted: string[] = [];
    for (let i = 0; i < ids.length; i += AIRTABLE_BATCH_LIMIT) {
      const chunk = ids.slice(i, i + AIRTABLE_BATCH_LIMIT);
      const url = new URL(this.tableUrl());
      for (const id of chunk) url.searchParams.append('records[]', id);

      let response: Response;
      try {
        response = await this.request('DELETE', url.toString());
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Airtable unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), 'delete');
      const data = (await response.json()) as { records: Array<{ id: string, deleted: boolean }> };
      for (const r of data.records) {
        if (r.deleted) deleted.push(r.id);
      }
    }
    return Result.succeed(deleted);
  }
}
