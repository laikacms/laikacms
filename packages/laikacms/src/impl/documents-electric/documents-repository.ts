import * as Effect from 'effect/Effect';

import { InvalidData, type LaikaError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
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

/** The Postgres column shape that Electric syncs to clients. */
export interface ElectricDocumentRow {
  key: string;
  depth: number;
  status: string;
  language: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/** A single Electric ChangeMessage for a row insert/update/delete. */
interface ElectricDataMessage {
  key: string;
  value: ElectricDocumentRow;
  headers: { action: 'insert' | 'update' | 'delete' };
}

/** Electric control message (e.g. up-to-date). */
interface ElectricControlMessage {
  headers: { control: string };
}

type ElectricMessage = ElectricDataMessage | ElectricControlMessage;

function isDataMessage(msg: ElectricMessage): msg is ElectricDataMessage {
  return 'value' in msg;
}

const parseContent = (raw: string): Effect.Effect<StorageObjectContent, LaikaError> =>
  Effect.try({
    try: () => JSON.parse(raw) as StorageObjectContent,
    catch: e =>
      new InvalidData(
        `[documents-electric] Invalid JSON content: ${e instanceof Error ? e.message : String(e)}`,
      ),
  });

export interface ElectricDocumentsRepositoryOptions {
  /** Base URL of the Electric service, e.g. `http://localhost:3000`. */
  baseUrl: string;
  /** Postgres table name that holds the documents rows. */
  table?: string | undefined;
  /**
   * Inner repository for all write operations. Electric is read-only by
   * design; writes go through this repo and the shape eventually reflects them.
   */
  innerRepo: DocumentsRepository;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
  /** Override `fetch`; defaults to `globalThis.fetch`. Useful for tests. */
  fetch?: typeof globalThis.fetch | undefined;
}

export class ElectricDocumentsRepository extends DocumentsRepository {
  private readonly baseUrl: string;
  private readonly table: string;
  private readonly _innerRepo: DocumentsRepository;
  private readonly logger: ElectricDocumentsRepositoryOptions['logger'];
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: ElectricDocumentsRepositoryOptions) {
    super();
    this.baseUrl = options.baseUrl;
    this.table = options.table ?? 'laika_documents';
    this._innerRepo = options.innerRepo;
    this.logger = options.logger;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private debug(op: string, detail?: string): void {
    if (!this.logger) return;
    this.logger.debug(`[documents-electric] ${op}${detail !== undefined ? ` ${detail}` : ''}`);
  }

  private shapeUrl(): string {
    return `${this.baseUrl}/v1/shape?table=${encodeURIComponent(this.table)}&offset=-1`;
  }

  /** Fetch the full shape snapshot and return all current rows. */
  private fetchShape(): Effect.Effect<ElectricDocumentRow[], LaikaError> {
    return Effect.tryPromise({
      try: async () => {
        this.debug('fetchShape', this.table);
        const res = await this.fetchImpl(this.shapeUrl());
        if (!res.ok) {
          throw new Error(`Electric shape fetch failed: ${res.status} ${res.statusText}`);
        }
        const msgs = await res.json() as ElectricMessage[];
        const rows = new Map<string, ElectricDocumentRow>();
        for (const msg of msgs) {
          if (!isDataMessage(msg)) continue;
          if (msg.headers.action === 'delete') {
            rows.delete(msg.value.key);
          } else {
            rows.set(msg.value.key, msg.value);
          }
        }
        return Array.from(rows.values());
      },
      catch: e =>
        new InvalidData(
          `[documents-electric] Shape fetch error: ${e instanceof Error ? e.message : String(e)}`,
        ),
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities> {
    return LaikaTask.succeed<DocumentsCapabilities>({
      compatibilityDate: DocumentsCompatibilityDate.make('2026-10-24'),
      pagination: {
        supported: true,
        description: 'In-process filtering of the shape snapshot; offset/limit slicing.',
        styles: { offset: true, page: true, cursor: false },
      },
      versionTracking: {
        supported: false,
        description: 'Electric carries no version token column.',
      },
      changes: {
        supported: false,
        description: 'No change log; getSyncToken/listChanges are not implemented.',
      },
    });
  }

  // ---- read path (via Electric shape) ----------------------------------------

  getDocument(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('getDocument', key);
        const rows = yield* this.fetchShape();
        const row = rows.find(r => r.key === key && r.status === PUBLISHED_STATUS);
        if (!row) return yield* Effect.fail(new NotFoundError(`Document not found: ${key}`));
        const content = yield* parseContent(row.content);
        return {
          type: 'published' as const,
          key: row.key,
          status: 'published' as const,
          content,
          language: row.language,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      })
    );
  }

  getUnpublished(key: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('getUnpublished', key);
        const rows = yield* this.fetchShape();
        const row = rows.find(r => r.key === key && r.status !== PUBLISHED_STATUS);
        if (!row) return yield* Effect.fail(new NotFoundError(`Unpublished document not found: ${key}`));
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
      })
    );
  }

  listRecords(options: ListRecordsOptions): LaikaStream.LaikaStream<DocumentRecord, ListRecordsDone> {
    return this.listRecordsInternal<DocumentRecord>(options, false);
  }

  listRecordSummaries(
    options: ListRecordSummaries,
  ): LaikaStream.LaikaStream<RecordSummary, ListRecordsDone> {
    return this.listRecordsInternal<RecordSummary>(options, true);
  }

  private listRecordsInternal<T extends DocumentRecord | RecordSummary>(
    options: ListRecordsOptions,
    summaryOnly: boolean,
  ): LaikaStream.LaikaStream<T, ListRecordsDone> {
    return LaikaStream.make<T, ListRecordsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        this.debug(summaryOnly ? 'listRecordSummaries' : 'listRecords', options.folder);
        const allRows = yield* this.fetchShape();

        const folderPrefix = options.folder ? `${options.folder}/` : null;
        const maxDepth = (options.folder ? pathToSegments(options.folder).length : 0) + options.depth;

        const filtered = allRows.filter(row => {
          if (options.type === 'published' && row.status !== PUBLISHED_STATUS) return false;
          if (options.type === 'unpublished' && row.status === PUBLISHED_STATUS) return false;
          if (options.statuses && !options.statuses.includes(row.status)) return false;
          if (folderPrefix && !row.key.startsWith(folderPrefix)) return false;
          if (row.depth > maxDepth) return false;
          return true;
        });

        filtered.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

        const offset = 'offset' in options.pagination
          ? (options.pagination.offset ?? 0)
          : 'page' in options.pagination
          ? (options.pagination.page - 1) * (options.pagination.perPage ?? 100)
          : 0;
        const limit = 'offset' in options.pagination
          ? (options.pagination.limit ?? 100)
          : 'page' in options.pagination
          ? (options.pagination.perPage ?? 100)
          : 100;

        const total = filtered.length;
        const page = filtered.slice(offset, offset + limit);

        for (const row of page) {
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
            continue;
          }
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
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            content: parsed.success,
          } as T);
        }
        return { total };
      })
    );
  }

  getRevision(key: string, revision: string): LaikaTask.LaikaTask<Revision> {
    return this._innerRepo.getRevision(key, revision);
  }

  listRevisions(
    key: string,
    options: ListRevisionsOptions,
  ): LaikaStream.LaikaStream<RevisionSummary, ListRevisionsDone> {
    return this._innerRepo.listRevisions(key, options);
  }

  // ---- write path (delegated to innerRepo) ------------------------------------

  createDocument(create: DocumentCreate): LaikaTask.LaikaTask<Document> {
    return this._innerRepo.createDocument(create);
  }

  updateDocument(update: DocumentUpdate): LaikaTask.LaikaTask<Document> {
    return this._innerRepo.updateDocument(update);
  }

  deleteDocument(key: string): LaikaTask.LaikaTask<void> {
    return this._innerRepo.deleteDocument(key);
  }

  createUnpublished(create: UnpublishedCreate): LaikaTask.LaikaTask<Unpublished> {
    return this._innerRepo.createUnpublished(create);
  }

  updateUnpublished(update: UnpublishedUpdate): LaikaTask.LaikaTask<Unpublished> {
    return this._innerRepo.updateUnpublished(update);
  }

  deleteUnpublished(key: string): LaikaTask.LaikaTask<void> {
    return this._innerRepo.deleteUnpublished(key);
  }

  publish(key: string): LaikaTask.LaikaTask<Document> {
    return this._innerRepo.publish(key);
  }

  unpublish(key: string, status: string): LaikaTask.LaikaTask<Unpublished> {
    return this._innerRepo.unpublish(key, status);
  }

  createRevision(create: RevisionCreate): LaikaTask.LaikaTask<Revision> {
    return this._innerRepo.createRevision(create);
  }
}
