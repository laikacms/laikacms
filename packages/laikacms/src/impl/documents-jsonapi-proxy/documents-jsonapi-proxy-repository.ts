import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';

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
  type GetSyncTokenOptions,
  type ListChangesDone,
  type ListChangesOptions,
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
  folderFromJsonApi,
  type FolderJsonApi,
  folderSummaryFromJsonApi,
  type FolderSummaryJsonApi,
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
} from 'laikacms/documents/api';
import { type ChangeSummary, SyncToken } from 'laikacms/storage';

import { JsonApiHttpTransport } from '../../shared/json-api/http-transport.js';
import { paginationCodec } from '../../shared/json-api/pagination-codec.js';
import { warningsFromMeta } from '../../shared/json-api/utilities.js';

export interface DocumentsJsonApiProxyRepositoryOptions {
  baseUrl: string;
  authToken?: string;
  /** Dynamic token provider — called before each request. */
  tokenPromise?: () => Promise<string>;
  /**
   * Effect `HttpClient` used for every request. Provide one client per
   * process (see `httpClientFromFetch` in `laikacms/json-api`) so all proxy
   * repositories share a single connection pool. Defaults to a client backed
   * by `globalThis.fetch`.
   */
  httpClient?: HttpClient.HttpClient;
}

/**
 * Proxies all document operations through a remote JSON:API endpoint.
 */
export class DocumentsJsonApiProxyRepository extends DocumentsRepository {
  private readonly transport: JsonApiHttpTransport;

  constructor(options: DocumentsJsonApiProxyRepositoryOptions) {
    super();
    this.transport = new JsonApiHttpTransport({
      ...options,
      networkError: message => new InternalError(message),
    });
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

  /**
   * Like {@link fetchResource} but also re-emits upstream `meta.warnings` as
   * recoverableErrors on the outer LaikaTask. Used by single-resource
   * write/read routes so warnings flow end-to-end through proxy chains.
   */
  private fetchResourceWithWarnings<T>(
    path: string,
    init: { method: string, body?: unknown },
    emit: LaikaTask.LaikaTaskEmit,
  ): Effect.Effect<T, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const json = yield* this.fetchJson(path, init);
      for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);
      return json.data as T;
    });
  }

  /** Execute an HTTP request and return the parsed JSON. */
  private fetchJson(
    path: string,
    init: { method: string, body?: unknown } = { method: 'GET' },
  ): Effect.Effect<{ data?: unknown, errors?: unknown[] } & Record<string, unknown>, LaikaError> {
    return this.transport.fetchJson(path, init, { rehydrateErrorCodes: true });
  }

  /** Issue a void/DELETE request and verify the response is OK. */
  private fetchVoid(
    path: string,
    init: { method: string, body?: unknown } = { method: 'GET' },
  ): Effect.Effect<void, LaikaError> {
    return Effect.asVoid(this.fetchJson(path, init));
  }

  /**
   * Like {@link fetchVoid} but re-emits upstream `meta.warnings` to the
   * caller's `emit`. The upstream documents-api returns
   * `{meta: {deleted: true, warnings?: [...]}}` on DELETE — warnings get
   * dropped by the plain `fetchVoid` because it discards the body.
   */
  private fetchVoidWithWarnings(
    path: string,
    init: { method: string, body?: unknown },
    emit: LaikaTask.LaikaMetadataEmit,
  ): Effect.Effect<void, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const json = yield* this.fetchJson(path, init);
      for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);
    });
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
          versionTracking: {
            supported: false,
            description: 'The remote endpoint did not advertise its capabilities.',
          },
          changes: {
            supported: false,
            description: 'The remote endpoint did not advertise its capabilities.',
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
        params.set('filter[type]', options.type ?? 'all');
        params.set('filter[depth]', '' + options.depth);
        // Omit filter[folder] when absent so the server lists all collections.
        if (options.folder) params.set('filter[folder]', options.folder);

        const json = yield* this.fetchJson(`/records?${params}`);
        const collection = json as unknown as JsonApiCollectionResponse;
        for (const w of warningsFromMeta(collection.meta)) yield* emit.recoverableError(w);

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
                    return folderFromJsonApi(item as FolderJsonApi) as unknown as DocumentRecord;
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
        return { total: collection.meta?.page?.total ?? emitted };
      })
    );
  }

  listRecordSummaries(
    options: ListRecordsOptions,
  ): LaikaStream.LaikaStream<RecordSummary, ListRecordsDone> {
    return LaikaStream.make<RecordSummary, ListRecordsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = paginationCodec.encode(options.pagination);
        params.set('filter[type]', options.type ?? 'all');
        params.set('filter[depth]', '' + options.depth);
        // Omit filter[folder] when absent so the server lists all collections.
        if (options.folder) params.set('filter[folder]', options.folder);

        const json = yield* this.fetchJson(`/record-summaries?${params}`);
        const collection = json as unknown as JsonApiCollectionResponse;
        for (const w of warningsFromMeta(collection.meta)) yield* emit.recoverableError(w);

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
                  case 'folder-summary':
                    return folderSummaryFromJsonApi(item as FolderSummaryJsonApi) as unknown as RecordSummary;
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
        return { total: collection.meta?.page?.total ?? emitted };
      })
    );
  }

  // ===== DOCUMENTS (PUBLISHED) =====

  getDocument(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<DocumentJsonApi>(
          `/published/${encodeURIComponent(key)}`,
          { method: 'GET' },
          emit,
        );
        return yield* Effect.try({
          try: () => documentFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  createDocument(create: DocumentCreate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<DocumentJsonApi>(
          `/published`,
          { method: 'POST', body: { data: documentCreateToJsonApi(create) } },
          emit,
        );
        return yield* Effect.try({
          try: () => documentFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  updateDocument(update: DocumentUpdate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<DocumentJsonApi>(
          `/published/${encodeURIComponent(update.key)}`,
          { method: 'PATCH', body: { data: documentUpdateToJsonApi(update) } },
          emit,
        );
        return yield* Effect.try({
          try: () => documentFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  deleteDocument(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(emit =>
      this.fetchVoidWithWarnings(
        `/published/${encodeURIComponent(key)}`,
        { method: 'DELETE' },
        emit,
      )
    );
  }

  // ===== UNPUBLISHED =====

  getUnpublished(key: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<UnpublishedJsonApi>(
          `/unpublished/${encodeURIComponent(key)}`,
          { method: 'GET' },
          emit,
        );
        return yield* Effect.try({
          try: () => unpublishedFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  createUnpublished(create: UnpublishedCreate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<UnpublishedJsonApi>(
          `/unpublished`,
          { method: 'POST', body: { data: unpublishedCreateToJsonApi(create) } },
          emit,
        );
        return yield* Effect.try({
          try: () => unpublishedFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  updateUnpublished(update: UnpublishedUpdate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<UnpublishedJsonApi>(
          `/unpublished/${encodeURIComponent(update.key)}`,
          { method: 'PATCH', body: { data: unpublishedUpdateToJsonApi(update) } },
          emit,
        );
        return yield* Effect.try({
          try: () => unpublishedFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  deleteUnpublished(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(emit =>
      this.fetchVoidWithWarnings(
        `/unpublished/${encodeURIComponent(key)}`,
        { method: 'DELETE' },
        emit,
      )
    );
  }

  publish(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<DocumentJsonApi>(
          `/unpublished/${encodeURIComponent(key)}/publish`,
          { method: 'POST' },
          emit,
        );
        return yield* Effect.try({
          try: () => documentFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  unpublish(key: string, status: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<UnpublishedJsonApi>(
          `/published/${encodeURIComponent(key)}/unpublish`,
          {
            method: 'POST',
            body: { data: { type: 'unpublished', attributes: { status } } },
          },
          emit,
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
    return LaikaTask.make<Revision>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<RevisionJsonApi>(
          `/revisions/${encodeURIComponent(key)}/${encodeURIComponent(revision)}`,
          { method: 'GET' },
          emit,
        );
        return yield* Effect.try({
          try: () => revisionFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  createRevision(create: RevisionCreate): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.make<Revision>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<RevisionJsonApi>(
          `/revisions`,
          { method: 'POST', body: { data: revisionCreateToJsonApi(create) } },
          emit,
        );
        return yield* Effect.try({
          try: () => revisionFromJsonApi(raw),
          catch: e => new InvalidData((e as Error).message),
        });
      })
    );
  }

  // ===== CHANGE SIGNALS =====

  override getSyncToken(options?: GetSyncTokenOptions): LaikaTask.LaikaTask<SyncToken> {
    return LaikaTask.make<SyncToken>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = new URLSearchParams();
        if (options?.folder) params.set('filter[folder]', options.folder);
        const qs = params.size > 0 ? `?${params}` : '';
        const raw = yield* this.fetchResourceWithWarnings<{ attributes?: { syncToken?: unknown } }>(
          `/sync-token${qs}`,
          { method: 'GET' },
          emit,
        );
        const token = raw?.attributes?.syncToken;
        if (typeof token !== 'string') {
          return yield* Effect.fail(
            new InvalidData('Upstream /sync-token response is missing attributes.syncToken'),
          );
        }
        return SyncToken.make(token);
      })
    );
  }

  override listChanges(
    options: ListChangesOptions,
  ): LaikaStream.LaikaStream<ChangeSummary, ListChangesDone> {
    return LaikaStream.make<ChangeSummary, ListChangesDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = new URLSearchParams();
        params.set('filter[since]', options.since);
        if (options.folder) params.set('filter[folder]', options.folder);

        const json = yield* this.fetchJson(`/changes?${params}`);
        const collection = json as unknown as JsonApiCollectionResponse & {
          meta?: { syncToken?: unknown, page?: { total?: number } },
        };
        for (const w of warningsFromMeta(collection.meta)) yield* emit.recoverableError(w);

        let emitted = 0;
        for (const item of collection.data) {
          const entry = item as { id: string, attributes?: { deleted?: unknown, version?: unknown } };
          const version = entry.attributes?.version;
          yield* emit.data({
            key: entry.id,
            deleted: entry.attributes?.deleted === true,
            ...(typeof version === 'string' ? { version } : {}),
          });
          emitted += 1;
        }

        const token = collection.meta?.syncToken;
        if (typeof token !== 'string') {
          return yield* Effect.fail(new InvalidData('Upstream /changes response is missing meta.syncToken'));
        }
        return {
          syncToken: SyncToken.make(token),
          total: collection.meta?.page?.total ?? emitted,
        };
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
        for (const w of warningsFromMeta(collection.meta)) yield* emit.recoverableError(w);

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
        return { total: collection.meta?.page?.total ?? emitted };
      })
    );
  }
}
