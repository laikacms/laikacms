import * as Effect from 'effect/Effect';

import {
  IllegalStateException,
  InternalError,
  InvalidData,
  type LaikaError,
  LaikaStream,
  LaikaTask,
} from 'laikacms/core';
import {
  type Document,
  type DocumentCreate,
  type DocumentsCapabilities,
  DocumentsCompatibilityDate,
  DocumentsRepository,
  type DocumentUpdate,
  type ListRecordsDone,
  type ListRecordsOptions,
  type ListRevisionsDone,
  type ListRevisionsOptions,
  type Record as DocumentRecord,
  type RecordSummary,
  type Revision,
  type RevisionCreate,
  type RevisionSummary,
  type Unpublished,
  type UnpublishedCreate,
  type UnpublishedUpdate,
} from 'laikacms/documents';
import {
  documentCreateToJsonApi,
  documentFromJsonApi,
  type DocumentJsonApi,
  documentSummaryFromJsonApi,
  type DocumentSummaryJsonApi,
  documentUpdateToJsonApi,
  type JsonApiCollectionResponse,
  revisionCreateToJsonApi,
  revisionFromJsonApi,
  type RevisionJsonApi,
  revisionSummaryFromJsonApi,
  type RevisionSummaryJsonApi,
  unpublishedCreateToJsonApi,
  unpublishedFromJsonApi,
  type UnpublishedJsonApi,
  unpublishedSummaryFromJsonApi,
  type UnpublishedSummaryJsonApi,
  unpublishedUpdateToJsonApi,
} from 'laikacms/documents-api';

import { paginationCodec } from '../../shared/json-api/pagination-codec.js';

export interface DocumentsJsonApiProxyRepositoryOptions {
  baseUrl: string;
  authToken?: string;
  /** Dynamic token provider — called before each request. */
  tokenPromise?: () => Promise<string>;
}

/**
 * Proxies all document operations through a remote JSON:API endpoint.
 */
export class DocumentsJsonApiProxyRepository extends DocumentsRepository {
  private readonly baseUrl: string;
  private readonly staticHeaders: HeadersInit;
  private readonly tokenPromise?: () => Promise<string>;

  constructor(options: DocumentsJsonApiProxyRepositoryOptions) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.tokenPromise = options.tokenPromise;
    this.staticHeaders = {
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
    };
  }

  private async getHeaders(): Promise<HeadersInit> {
    if (this.tokenPromise) {
      const token = await this.tokenPromise();
      return { ...this.staticHeaders, Authorization: `Bearer ${token}` };
    }
    return this.staticHeaders;
  }

  /** Execute an HTTP request and return the JSON:API resource or fail. */
  private fetchResource<T>(
    path: string,
    init: { method: string, body?: unknown } = { method: 'GET' },
  ): Effect.Effect<T, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const json = yield* this.fetchJson(path, init);
      return json.data as T;
    });
  }

  /** Execute an HTTP request and return the parsed JSON. */
  private fetchJson(
    path: string,
    init: { method: string, body?: unknown } = { method: 'GET' },
  ): Effect.Effect<{ data?: unknown, errors?: unknown[] } & Record<string, unknown>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const headers = yield* Effect.promise(() => this.getHeaders());
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${this.baseUrl}${path}`, {
            method: init.method,
            headers,
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          }),
        catch: e => new InternalError((e as Error).message),
      });
      const contentType = response.headers.get('content-type');
      const isJson = contentType?.includes('application/vnd.api+json')
        || contentType?.includes('application/json');
      if (!isJson) {
        const bodySnippet = yield* Effect.promise(() =>
          response.text().then(t => t.slice(0, 500)).catch(() => '<unreadable>')
        );
        return yield* Effect.fail(
          new InvalidData(
            `${init.method} ${path} → ${response.status} ${response.statusText} `
              + `(content-type: ${contentType ?? 'none'}): ${bodySnippet}`,
          ),
        );
      }
      const json = yield* Effect.promise(() => response.json() as Promise<Record<string, unknown>>);
      if (!response.ok || (Array.isArray(json.errors) && json.errors.length > 0)) {
        const errors = (Array.isArray(json.errors) ? json.errors : [{ detail: 'Unknown error' }]) as Array<
          { detail?: string, title?: string }
        >;
        return yield* Effect.fail(
          new InvalidData(errors.map(e => e.detail || e.title || 'Unknown error').join(', ')),
        );
      }
      return json as { data?: unknown, errors?: unknown[] } & Record<string, unknown>;
    });
  }

  /** Issue a void/DELETE request and verify the response is OK. */
  private fetchVoid(
    path: string,
    init: { method: string, body?: unknown } = { method: 'GET' },
  ): Effect.Effect<void, LaikaError> {
    return Effect.asVoid(this.fetchJson(path, init));
  }

  /**
   * Cached upstream capabilities. The remote documents-api exposes
   * `GET /capabilities` returning the real backing repo's capabilities, so
   * we fetch + cache it per repo instance. Falls back to a conservative
   * default if the upstream doesn't speak the endpoint yet.
   */
  private cachedCapabilities?: DocumentsCapabilities;

  getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities> {
    return LaikaTask.make<DocumentsCapabilities>(() =>
      Effect.gen({ self: this }, function*() {
        if (this.cachedCapabilities) return this.cachedCapabilities;
        const r = yield* Effect.result(this.fetchJson('/capabilities'));
        if (r._tag === 'Success') {
          const data = (r.success.data as { attributes?: DocumentsCapabilities } | undefined)
            ?.attributes;
          if (data) {
            this.cachedCapabilities = data;
            return data;
          }
        }
        const fallback: DocumentsCapabilities = {
          compatibilityDate: DocumentsCompatibilityDate.make('2026-05-11'),
          pagination: {
            supported: true,
            description: 'JSON:API pagination is forwarded to the remote endpoint.',
            styles: { offset: true, page: true, cursor: true },
          },
        };
        this.cachedCapabilities = fallback;
        return fallback;
      })
    );
  }

  // ===== RECORDS =====

  listRecords(options: ListRecordsOptions): LaikaStream.LaikaStream<DocumentRecord, ListRecordsDone> {
    return LaikaStream.make<DocumentRecord, ListRecordsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = paginationCodec.encode(options.pagination);
        if (options.type) params.set('filter[type]', options.type);
        params.set('filter[depth]', '' + options.depth);
        params.set('filter[folder]', options.folder);

        const json = yield* this.fetchJson(`/records?${params}`);
        const collection = json as unknown as JsonApiCollectionResponse;

        let emitted = 0;
        for (const item of collection.data) {
          const decoded = yield* Effect.result(
            Effect.try({
              try: (): DocumentRecord => {
                switch (item.type) {
                  case 'published':
                    return documentFromJsonApi(item as DocumentJsonApi) as DocumentRecord;
                  case 'unpublished':
                    return unpublishedFromJsonApi(item as UnpublishedJsonApi) as DocumentRecord;
                  case 'revision':
                    return revisionFromJsonApi(item as RevisionJsonApi) as unknown as DocumentRecord;
                  case 'folder':
                    return undefined as unknown as DocumentRecord; // skipped below
                  default:
                    throw new IllegalStateException('Unknown record type: ' + item.type);
                }
              },
              catch: e => new InvalidData((e as Error).message),
            }),
          );
          if (decoded._tag === 'Failure') {
            yield* emit.recoverableError(decoded.failure);
            continue;
          }
          if (decoded.success === undefined) continue; // folder entry
          yield* emit.data(decoded.success);
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  listRecordSummaries(
    options: ListRecordsOptions,
  ): LaikaStream.LaikaStream<RecordSummary, ListRecordsDone> {
    return LaikaStream.make<RecordSummary, ListRecordsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = paginationCodec.encode(options.pagination);
        if (options.type) params.set('filter[type]', options.type);
        params.set('filter[depth]', '' + options.depth);
        params.set('filter[folder]', options.folder);

        const json = yield* this.fetchJson(`/record-summaries?${params}`);
        const collection = json as unknown as JsonApiCollectionResponse;

        let emitted = 0;
        for (const item of collection.data) {
          const decoded = yield* Effect.result(
            Effect.try({
              try: (): RecordSummary | undefined => {
                switch (item.type) {
                  case 'published':
                  case 'published-summary':
                    return documentSummaryFromJsonApi(item as DocumentSummaryJsonApi) as RecordSummary;
                  case 'unpublished':
                  case 'unpublished-summary':
                    return unpublishedSummaryFromJsonApi(item as UnpublishedSummaryJsonApi) as RecordSummary;
                  case 'revision':
                  case 'revision-summary':
                    return revisionSummaryFromJsonApi(item as RevisionSummaryJsonApi) as unknown as RecordSummary;
                  case 'folder':
                    return undefined;
                  default:
                    throw new IllegalStateException('Unknown record type: ' + item.type);
                }
              },
              catch: e => new InvalidData((e as Error).message),
            }),
          );
          if (decoded._tag === 'Failure') {
            yield* emit.recoverableError(decoded.failure);
            continue;
          }
          if (decoded.success === undefined) continue;
          yield* emit.data(decoded.success);
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  // ===== DOCUMENTS (PUBLISHED) =====

  getDocument(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResource<DocumentJsonApi>(
          `/published/${encodeURIComponent(key)}`,
        );
        return yield* Effect.try({
          try: () => documentFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  createDocument(create: DocumentCreate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResource<DocumentJsonApi>(
          `/published`,
          { method: 'POST', body: { data: documentCreateToJsonApi(create) } },
        );
        return yield* Effect.try({
          try: () => documentFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  updateDocument(update: DocumentUpdate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResource<DocumentJsonApi>(
          `/published/${encodeURIComponent(update.key)}`,
          { method: 'PATCH', body: { data: documentUpdateToJsonApi(update) } },
        );
        return yield* Effect.try({
          try: () => documentFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  deleteDocument(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      this.fetchVoid(`/published/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    );
  }

  // ===== UNPUBLISHED =====

  getUnpublished(key: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResource<UnpublishedJsonApi>(
          `/unpublished/${encodeURIComponent(key)}`,
        );
        return yield* Effect.try({
          try: () => unpublishedFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  createUnpublished(create: UnpublishedCreate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResource<UnpublishedJsonApi>(
          `/unpublished`,
          { method: 'POST', body: { data: unpublishedCreateToJsonApi(create) } },
        );
        return yield* Effect.try({
          try: () => unpublishedFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  updateUnpublished(update: UnpublishedUpdate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResource<UnpublishedJsonApi>(
          `/unpublished/${encodeURIComponent(update.key)}`,
          { method: 'PATCH', body: { data: unpublishedUpdateToJsonApi(update) } },
        );
        return yield* Effect.try({
          try: () => unpublishedFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  deleteUnpublished(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      this.fetchVoid(`/unpublished/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    );
  }

  publish(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResource<DocumentJsonApi>(
          `/unpublished/${encodeURIComponent(key)}/publish`,
          { method: 'POST' },
        );
        return yield* Effect.try({
          try: () => documentFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  unpublish(key: string, status: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResource<UnpublishedJsonApi>(
          `/published/${encodeURIComponent(key)}/unpublish`,
          {
            method: 'POST',
            body: { data: { type: 'unpublished', attributes: { status } } },
          },
        );
        return yield* Effect.try({
          try: () => unpublishedFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  // ===== REVISIONS =====

  getRevision(key: string, revision: string): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.make<Revision>(() =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResource<RevisionJsonApi>(
          `/revisions/${encodeURIComponent(key)}/${encodeURIComponent(revision)}`,
        );
        return yield* Effect.try({
          try: () => revisionFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  createRevision(create: RevisionCreate): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.make<Revision>(() =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResource<RevisionJsonApi>(
          `/revisions`,
          { method: 'POST', body: { data: revisionCreateToJsonApi(create) } },
        );
        return yield* Effect.try({
          try: () => revisionFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  listRevisions(
    key: string,
    options: ListRevisionsOptions,
  ): LaikaStream.LaikaStream<RevisionSummary, ListRevisionsDone> {
    return LaikaStream.make<RevisionSummary, ListRevisionsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = paginationCodec.encode(options.pagination);
        const json = yield* this.fetchJson(`/revisions/${encodeURIComponent(key)}?${params}`);
        const collection = json as unknown as JsonApiCollectionResponse;

        let emitted = 0;
        for (const item of collection.data) {
          const decoded = yield* Effect.result(
            Effect.try({
              try: () => revisionSummaryFromJsonApi(item as RevisionSummaryJsonApi),
              catch: e => new InvalidData((e as Error).message),
            }),
          );
          if (decoded._tag === 'Failure') {
            yield* emit.recoverableError(decoded.failure);
            continue;
          }
          yield* emit.data(decoded.success);
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }
}
