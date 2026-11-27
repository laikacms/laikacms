import * as Effect from 'effect/Effect';

import {
  EntryAlreadyExistsError,
  InvalidData,
  type LaikaError,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
import type {
  Document,
  DocumentCreate,
  DocumentsCapabilities,
  DocumentUpdate,
  ListRecordsDone,
  ListRecordsOptions,
  ListRecordSummaries,
  ListRevisionsDone,
  ListRevisionsOptions,
  Record as DocumentRecord,
  RecordSummary,
  Revision,
  RevisionCreate,
  RevisionSummary,
  Unpublished,
  UnpublishedCreate,
  UnpublishedUpdate,
} from 'laikacms/documents';
import { DocumentsCompatibilityDate, DocumentsRepository, pathToSegments } from 'laikacms/documents';
import type { StorageObjectContent } from 'laikacms/storage';

const PUBLISHED_STATUS = 'published';

const RECORD_API_BASE = '/api/records/v1';

export interface TrailBaseDocumentRow {
  id?: string;
  key: string;
  depth: number;
  status: string;
  language: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface TrailBaseRevisionRow {
  id?: string;
  key: string;
  revision: string;
  language: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface TrailBaseListResponse<T> {
  records: T[];
  cursor?: string;
  total_count?: number;
}

interface TrailBaseCreateResponse {
  ids: string[];
}

export interface TrailBaseDocumentsRepositoryOptions {
  /** Base URL of the TrailBase instance, e.g. `http://localhost:4000`. */
  baseUrl: string;
  /** Auth token passed as `Authorization: Bearer <token>`. */
  authToken?: string | undefined;
  /** Table name for documents. Defaults to `laika_documents`. */
  documentsTable?: string | undefined;
  /** Table name for revisions. Defaults to `laika_revisions`. */
  revisionsTable?: string | undefined;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
  /** Override `fetch`; defaults to `globalThis.fetch`. Useful for tests. */
  fetch?: typeof globalThis.fetch | undefined;
}

const parseContent = (raw: string): Effect.Effect<StorageObjectContent, LaikaError> =>
  Effect.try({
    try: () => JSON.parse(raw) as StorageObjectContent,
    catch: e =>
      new InvalidData(
        `[documents-trailbase] Invalid JSON content: ${e instanceof Error ? e.message : String(e)}`,
      ),
  });

export class TrailBaseDocumentsRepository extends DocumentsRepository {
  private readonly baseUrl: string;
  private readonly authToken: string | undefined;
  private readonly documentsTable: string;
  private readonly revisionsTable: string;
  private readonly logger: TrailBaseDocumentsRepositoryOptions['logger'];
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: TrailBaseDocumentsRepositoryOptions) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.authToken = options.authToken;
    this.documentsTable = options.documentsTable ?? 'laika_documents';
    this.revisionsTable = options.revisionsTable ?? 'laika_revisions';
    this.logger = options.logger;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private debug(op: string, detail?: string): void {
    if (!this.logger) return;
    this.logger.debug(`[documents-trailbase] ${op}${detail !== undefined ? ` ${detail}` : ''}`);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) h['Authorization'] = `Bearer ${this.authToken}`;
    return h;
  }

  private tableUrl(table: string): string {
    return `${this.baseUrl}${RECORD_API_BASE}/${encodeURIComponent(table)}`;
  }

  private async apiFetch(url: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers as Record<string, string> | undefined) },
    });
    return res;
  }

  private async listRows<T>(table: string, params: URLSearchParams): Promise<TrailBaseListResponse<T>> {
    const url = `${this.tableUrl(table)}?${params.toString()}`;
    this.debug('listRows', url);
    const res = await this.apiFetch(url);
    if (!res.ok) {
      throw new Error(`[documents-trailbase] listRows ${table} failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<TrailBaseListResponse<T>>;
  }

  private async getRowById<T>(table: string, id: string): Promise<T | null> {
    const url = `${this.tableUrl(table)}/${encodeURIComponent(id)}`;
    this.debug('getRowById', `${table}/${id}`);
    const res = await this.apiFetch(url);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`[documents-trailbase] getRowById ${table}/${id} failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  private async findDocRow(
    key: string,
    statusFilter?: { eq?: string, ne?: string },
  ): Promise<TrailBaseDocumentRow | null> {
    const params = new URLSearchParams();
    params.set('filter[key][$eq]', key);
    if (statusFilter?.eq) params.set('filter[status][$eq]', statusFilter.eq);
    if (statusFilter?.ne) params.set('filter[status][$ne]', statusFilter.ne);
    params.set('limit', '1');
    const { records } = await this.listRows<TrailBaseDocumentRow>(this.documentsTable, params);
    return records[0] ?? null;
  }

  private async createRow<T>(table: string, body: Record<string, unknown>): Promise<TrailBaseCreateResponse> {
    const res = await this.apiFetch(this.tableUrl(table), {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[documents-trailbase] createRow ${table} failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<TrailBaseCreateResponse>;
  }

  private async patchRow(table: string, id: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.apiFetch(`${this.tableUrl(table)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[documents-trailbase] patchRow ${table}/${id} failed: ${res.status} ${text}`);
    }
  }

  private async deleteRow(table: string, id: string): Promise<void> {
    const res = await this.apiFetch(`${this.tableUrl(table)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`[documents-trailbase] deleteRow ${table}/${id} failed: ${res.status} ${text}`);
    }
  }

  private rowToDocument(row: TrailBaseDocumentRow): Effect.Effect<Document, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const content = yield* parseContent(row.content);
      return {
        type: 'published' as const,
        key: row.key,
        status: 'published' as const,
        language: row.language,
        content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private rowToUnpublished(row: TrailBaseDocumentRow): Effect.Effect<Unpublished, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const content = yield* parseContent(row.content);
      return {
        type: 'unpublished' as const,
        key: row.key,
        status: row.status,
        language: row.language,
        content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private rowToRevision(row: TrailBaseRevisionRow): Effect.Effect<Revision, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const content = yield* parseContent(row.content);
      return {
        type: 'revision' as const,
        key: row.key,
        revision: row.revision,
        language: row.language,
        content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities> {
    return LaikaTask.succeed<DocumentsCapabilities>({
      compatibilityDate: DocumentsCompatibilityDate.make('2026-11-27'),
      pagination: {
        supported: true,
        description: 'Backed by TrailBase offset/limit pagination.',
        styles: { offset: true, page: true, cursor: false },
      },
      versionTracking: {
        supported: false,
        description: 'TrailBase does not expose a row version token.',
      },
      changes: {
        supported: false,
        description: 'No change log; getSyncToken/listChanges are not implemented.',
      },
    });
  }

  getDocument(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('getDocument', key);
        const row = yield* Effect.tryPromise({
          try: () => this.findDocRow(key, { eq: PUBLISHED_STATUS }),
          catch: e =>
            new InvalidData(`[documents-trailbase] getDocument error: ${e instanceof Error ? e.message : String(e)}`),
        });
        if (!row) return yield* Effect.fail(new NotFoundError(`Document not found: ${key}`));
        return yield* this.rowToDocument(row);
      })
    );
  }

  getUnpublished(key: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('getUnpublished', key);
        const row = yield* Effect.tryPromise({
          try: () => this.findDocRow(key, { ne: PUBLISHED_STATUS }),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] getUnpublished error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        if (!row) return yield* Effect.fail(new NotFoundError(`Unpublished document not found: ${key}`));
        return yield* this.rowToUnpublished(row);
      })
    );
  }

  createDocument(create: DocumentCreate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('createDocument', create.key);
        // Check for existing
        const existing = yield* Effect.tryPromise({
          try: () => this.findDocRow(create.key),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] createDocument check error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        if (existing) {
          return yield* Effect.fail(new EntryAlreadyExistsError(`Document already exists: ${create.key}`));
        }
        const now = new Date().toISOString();
        yield* Effect.tryPromise({
          try: () =>
            this.createRow(this.documentsTable, {
              key: create.key,
              depth: pathToSegments(create.key).length,
              status: PUBLISHED_STATUS,
              language: create.language,
              content: JSON.stringify(create.content),
              created_at: now,
              updated_at: now,
            }),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] createDocument error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        return yield* LaikaTask.runValue(this.getDocument(create.key));
      })
    );
  }

  updateDocument(update: DocumentUpdate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('updateDocument', update.key);
        const row = yield* Effect.tryPromise({
          try: () => this.findDocRow(update.key, { eq: PUBLISHED_STATUS }),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] updateDocument error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        if (!row?.id) return yield* Effect.fail(new NotFoundError(`Document not found: ${update.key}`));
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (update.content !== undefined) patch['content'] = JSON.stringify(update.content);
        if (update.language !== undefined) patch['language'] = update.language;
        yield* Effect.tryPromise({
          try: () => this.patchRow(this.documentsTable, row.id!, patch),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] updateDocument patch error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        return yield* LaikaTask.runValue(this.getDocument(update.key));
      })
    );
  }

  deleteDocument(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('deleteDocument', key);
        const row = yield* Effect.tryPromise({
          try: () => this.findDocRow(key, { eq: PUBLISHED_STATUS }),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] deleteDocument error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        if (!row?.id) return yield* Effect.fail(new NotFoundError(`Document not found: ${key}`));
        yield* Effect.tryPromise({
          try: () => this.deleteRow(this.documentsTable, row.id!),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] deleteDocument delete error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
      })
    );
  }

  createUnpublished(create: UnpublishedCreate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('createUnpublished', create.key);
        const existing = yield* Effect.tryPromise({
          try: () => this.findDocRow(create.key),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] createUnpublished check error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        if (existing) {
          return yield* Effect.fail(new EntryAlreadyExistsError(`Document already exists: ${create.key}`));
        }
        const now = new Date().toISOString();
        yield* Effect.tryPromise({
          try: () =>
            this.createRow(this.documentsTable, {
              key: create.key,
              depth: pathToSegments(create.key).length,
              status: create.status,
              language: create.language,
              content: JSON.stringify(create.content),
              created_at: now,
              updated_at: now,
            }),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] createUnpublished error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        return yield* LaikaTask.runValue(this.getUnpublished(create.key));
      })
    );
  }

  updateUnpublished(update: UnpublishedUpdate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('updateUnpublished', update.key);
        const row = yield* Effect.tryPromise({
          try: () => this.findDocRow(update.key, { ne: PUBLISHED_STATUS }),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] updateUnpublished error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        if (!row?.id) return yield* Effect.fail(new NotFoundError(`Unpublished document not found: ${update.key}`));
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (update.content !== undefined) patch['content'] = JSON.stringify(update.content);
        if (update.language !== undefined) patch['language'] = update.language;
        if (update.status !== undefined) patch['status'] = update.status;
        yield* Effect.tryPromise({
          try: () => this.patchRow(this.documentsTable, row.id!, patch),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] updateUnpublished patch error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        return yield* LaikaTask.runValue(this.getUnpublished(update.key));
      })
    );
  }

  deleteUnpublished(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('deleteUnpublished', key);
        const row = yield* Effect.tryPromise({
          try: () => this.findDocRow(key, { ne: PUBLISHED_STATUS }),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] deleteUnpublished error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        if (!row?.id) return yield* Effect.fail(new NotFoundError(`Unpublished document not found: ${key}`));
        yield* Effect.tryPromise({
          try: () => this.deleteRow(this.documentsTable, row.id!),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] deleteUnpublished delete error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
      })
    );
  }

  publish(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('publish', key);
        const row = yield* Effect.tryPromise({
          try: () => this.findDocRow(key, { ne: PUBLISHED_STATUS }),
          catch: e =>
            new InvalidData(`[documents-trailbase] publish error: ${e instanceof Error ? e.message : String(e)}`),
        });
        if (!row?.id) return yield* Effect.fail(new NotFoundError(`Unpublished document not found: ${key}`));
        yield* Effect.tryPromise({
          try: () =>
            this.patchRow(this.documentsTable, row.id!, {
              status: PUBLISHED_STATUS,
              updated_at: new Date().toISOString(),
            }),
          catch: e =>
            new InvalidData(`[documents-trailbase] publish patch error: ${e instanceof Error ? e.message : String(e)}`),
        });
        return yield* LaikaTask.runValue(this.getDocument(key));
      })
    );
  }

  unpublish(key: string, status: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('unpublish', key);
        const row = yield* Effect.tryPromise({
          try: () => this.findDocRow(key, { eq: PUBLISHED_STATUS }),
          catch: e =>
            new InvalidData(`[documents-trailbase] unpublish error: ${e instanceof Error ? e.message : String(e)}`),
        });
        if (!row?.id) return yield* Effect.fail(new NotFoundError(`Published document not found: ${key}`));
        yield* Effect.tryPromise({
          try: () =>
            this.patchRow(this.documentsTable, row.id!, {
              status,
              updated_at: new Date().toISOString(),
            }),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] unpublish patch error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        return yield* LaikaTask.runValue(this.getUnpublished(key));
      })
    );
  }

  listRecords(options: ListRecordsOptions): LaikaStream.LaikaStream<DocumentRecord, ListRecordsDone> {
    return this.listRecordsInternal<DocumentRecord>(options, false);
  }

  listRecordSummaries(options: ListRecordSummaries): LaikaStream.LaikaStream<RecordSummary, ListRecordsDone> {
    return this.listRecordsInternal<RecordSummary>(options, true);
  }

  private listRecordsInternal<T extends DocumentRecord | RecordSummary>(
    options: ListRecordsOptions,
    summaryOnly: boolean,
  ): LaikaStream.LaikaStream<T, ListRecordsDone> {
    return LaikaStream.make<T, ListRecordsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        this.debug(summaryOnly ? 'listRecordSummaries' : 'listRecords', options.folder);

        const params = new URLSearchParams();

        const folderPrefix = options.folder ? `${options.folder}/` : '';
        if (folderPrefix) {
          params.set('filter[key][$like]', `${folderPrefix}%`);
        }

        const folderDepth = options.folder ? pathToSegments(options.folder).length : 0;
        const maxDepth = folderDepth + options.depth;
        params.set('filter[depth][$lte]', String(maxDepth));

        if (options.type === 'published') {
          params.set('filter[status][$eq]', PUBLISHED_STATUS);
        } else if (options.type === 'unpublished') {
          params.set('filter[status][$ne]', PUBLISHED_STATUS);
        } else if (options.statuses && options.statuses.length > 0) {
          // TrailBase doesn't support IN natively via URL params, so we filter in-process below
        }

        let limit: number;
        let offset: number;
        if ('page' in options.pagination) {
          const perPage = options.pagination.perPage ?? 100;
          limit = perPage;
          offset = (options.pagination.page - 1) * perPage;
        } else {
          limit = 'limit' in options.pagination ? (options.pagination.limit ?? 100) : 100;
          offset = 'offset' in options.pagination ? (options.pagination.offset ?? 0) : 0;
        }
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        params.set('count', 'true');

        const { records, total_count } = yield* Effect.tryPromise({
          try: () => this.listRows<TrailBaseDocumentRow>(this.documentsTable, params),
          catch: e =>
            new InvalidData(`[documents-trailbase] listRecords error: ${e instanceof Error ? e.message : String(e)}`),
        });

        const filtered = options.statuses && options.statuses.length > 0
          ? records.filter(r => options.statuses!.includes(r.status))
          : records;

        for (const row of filtered) {
          const isPublished = row.status === PUBLISHED_STATUS;
          if (summaryOnly) {
            yield* emit.data({
              type: isPublished ? 'published-summary' : 'unpublished-summary',
              key: row.key,
              status: row.status,
              language: row.language,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            } as T);
          } else {
            const parsed = yield* Effect.result(parseContent(row.content));
            if (parsed._tag === 'Failure') {
              yield* emit.recoverableError(parsed.failure);
              continue;
            }
            yield* emit.data({
              type: isPublished ? 'published' : 'unpublished',
              key: row.key,
              status: row.status,
              language: row.language,
              content: parsed.success,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            } as T);
          }
        }

        return { total: total_count ?? filtered.length };
      })
    );
  }

  createRevision(create: RevisionCreate): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.make<Revision>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('createRevision', `${create.key}@${create.revision}`);
        const now = new Date().toISOString();
        yield* Effect.tryPromise({
          try: () =>
            this.createRow(this.revisionsTable, {
              key: create.key,
              revision: create.revision,
              language: create.language,
              content: JSON.stringify(create.content),
              created_at: now,
              updated_at: now,
            }),
          catch: e =>
            new InvalidData(
              `[documents-trailbase] createRevision error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        return yield* LaikaTask.runValue(this.getRevision(create.key, create.revision));
      })
    );
  }

  getRevision(key: string, revision: string): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.make<Revision>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('getRevision', `${key}@${revision}`);
        const params = new URLSearchParams();
        params.set('filter[key][$eq]', key);
        params.set('filter[revision][$eq]', revision);
        params.set('limit', '1');
        const { records } = yield* Effect.tryPromise({
          try: () => this.listRows<TrailBaseRevisionRow>(this.revisionsTable, params),
          catch: e =>
            new InvalidData(`[documents-trailbase] getRevision error: ${e instanceof Error ? e.message : String(e)}`),
        });
        const row = records[0];
        if (!row) return yield* Effect.fail(new NotFoundError(`Revision not found: ${key}@${revision}`));
        return yield* this.rowToRevision(row);
      })
    );
  }

  listRevisions(
    key: string,
    options: ListRevisionsOptions,
  ): LaikaStream.LaikaStream<RevisionSummary, ListRevisionsDone> {
    return LaikaStream.make<RevisionSummary, ListRevisionsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        this.debug('listRevisions', key);
        const params = new URLSearchParams();
        params.set('filter[key][$eq]', key);

        let limit: number;
        let offset: number;
        if ('page' in options.pagination) {
          const perPage = options.pagination.perPage ?? 100;
          limit = perPage;
          offset = (options.pagination.page - 1) * perPage;
        } else {
          limit = 'limit' in options.pagination ? (options.pagination.limit ?? 100) : 100;
          offset = 'offset' in options.pagination ? (options.pagination.offset ?? 0) : 0;
        }
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        params.set('count', 'true');

        const { records, total_count } = yield* Effect.tryPromise({
          try: () => this.listRows<TrailBaseRevisionRow>(this.revisionsTable, params),
          catch: e =>
            new InvalidData(`[documents-trailbase] listRevisions error: ${e instanceof Error ? e.message : String(e)}`),
        });

        for (const row of records) {
          yield* emit.data({
            type: 'revision-summary' as const,
            key: row.key,
            revision: row.revision,
            language: row.language,
            createdAt: row.created_at,
          });
        }

        return { total: total_count ?? records.length };
      })
    );
  }
}
