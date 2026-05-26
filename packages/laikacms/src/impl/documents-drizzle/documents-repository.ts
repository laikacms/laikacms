import * as Effect from 'effect/Effect';

import { InvalidData, type LaikaError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type {
  Document,
  DocumentCreate,
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
import {
  type DocumentsCapabilities,
  DocumentsCompatibilityDate,
  DocumentsRepository,
  pathToSegments,
} from 'laikacms/documents';
import { type StorageObjectContent } from 'laikacms/storage';

const PUBLISHED_STATUS = 'published';

export type DocumentModel = {
  key: string,
  depth: number,
  status: string | null | undefined,
  language: string | null | undefined,
  content: string,
  createdAt: string,
  updatedAt: string,
};

export type DocumentModelStrict = DocumentModel & {
  status: string,
  language: string,
};

export type RevisionModel = {
  key: string,
  depth: number,
  revision: string,
  language: string | null | undefined,
  content: string,
  createdAt: string,
  updatedAt: string,
};

export type RevisionModelStrict = RevisionModel & {
  revision: string,
  language: string,
};

export interface DrizzleDocumentsRepositoryOptions<CKE, CKSW, CSE, CSNE, CSI, CDLTE, CA, RKE, RE, RA> {
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
  documentQueryBuilders: {
    keyEquals: (value: string) => CKE,
    keyStartsWith: (prefix: string) => CKSW,
    statusEquals: (value: string) => CSE,
    statusNotEquals: (value: string) => CSNE,
    statusIn: (values: string[]) => CSI,
    depthLte: (value: number) => CDLTE,
    and: (...conditions: (CKE | CKSW | CSE | CSNE | CSI | CDLTE | CA)[]) => CA,
  };
  revisionQueryBuilders: {
    keyEquals: (value: string) => RKE,
    revisionEquals: (value: string) => RE,
    and: (...conditions: (RKE | RE | RA)[]) => RA,
  };
  callbacks: {
    documents: {
      insert: (query: { values: DocumentModelStrict }) => Promise<DocumentModel[]>,
      update: (query: {
        where: CKE | CSNE | CSE | CKSW | CSI | CDLTE | CA,
        values: Partial<DocumentModelStrict>,
      }) => Promise<DocumentModel[]>,
      delete: (query: { where: CKE | CSNE | CSE | CKSW | CSI | CDLTE | CA }) => Promise<DocumentModel[]>,
      select: (query: {
        where: CKE | CSNE | CSE | CKSW | CSI | CDLTE | CA,
        excludeContent?: boolean,
        limit?: number,
        offset?: number,
      }) => Promise<DocumentModel[]>,
    },
    revisions: {
      insert: (query: { values: RevisionModelStrict }) => Promise<RevisionModel[]>,
      update: (query: {
        where: RKE | RE | RA,
        values: Partial<RevisionModelStrict>,
      }) => Promise<RevisionModel[]>,
      delete: (query: { where: RKE | RE | RA }) => Promise<RevisionModel[]>,
      select: (query: {
        where: RKE | RE | RA,
        limit?: number,
        excludeContent?: boolean,
      }) => Promise<RevisionModel[]>,
    },
  };
}

const parseContent = (raw: string): Effect.Effect<StorageObjectContent, LaikaError> =>
  Effect.try({
    try: () => JSON.parse(raw) as StorageObjectContent,
    catch: e =>
      new InvalidData(
        `Invalid JSON content format: ${e instanceof Error ? e.message : 'Unknown error'}`,
      ),
  });

export class DrizzleDocumentsRepository<CKE, CKSW, CSE, CSNE, CSI, CDLTE, CA, RKE, RE, RA> extends DocumentsRepository {
  constructor(
    private options: DrizzleDocumentsRepositoryOptions<CKE, CKSW, CSE, CSNE, CSI, CDLTE, CA, RKE, RE, RA>,
  ) {
    super();
  }

  getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities> {
    return LaikaTask.succeed<DocumentsCapabilities>({
      compatibilityDate: DocumentsCompatibilityDate.make('2026-05-11'),
      pagination: {
        supported: true,
        description: 'Backed by SQL OFFSET/LIMIT and page-based windowing.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }

  getDocument(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const qb = this.options.documentQueryBuilders;
        const rows = yield* Effect.promise(() =>
          this.options.callbacks.documents.select({
            where: qb.and(qb.keyEquals(key), qb.statusEquals(PUBLISHED_STATUS)),
            limit: 1,
          })
        );
        if (rows.length === 0) {
          return yield* Effect.fail(new NotFoundError(`Document not found: ${key}`));
        }
        const row = rows[0]!;
        const content = yield* parseContent(row.content);
        return {
          type: 'published' as const,
          key: row.key,
          status: 'published' as const,
          content,
          language: row.language ?? 'unk',
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      })
    );
  }

  createDocument(create: DocumentCreate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const now = new Date().toISOString();
        yield* Effect.promise(() =>
          this.options.callbacks.documents.insert({
            values: {
              key: create.key,
              depth: pathToSegments(create.key).length,
              status: PUBLISHED_STATUS,
              language: create.language,
              content: JSON.stringify(create.content),
              createdAt: now,
              updatedAt: now,
            },
          })
        );
        return yield* LaikaTask.runValue(this.getDocument(create.key));
      })
    );
  }

  updateDocument(update: DocumentUpdate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const qb = this.options.documentQueryBuilders;
        const now = new Date().toISOString();
        yield* Effect.promise(() =>
          this.options.callbacks.documents.update({
            where: qb.and(qb.keyEquals(update.key), qb.statusEquals(PUBLISHED_STATUS)),
            values: {
              updatedAt: now,
              ...(update.content ? { content: JSON.stringify(update.content) } : {}),
              ...(update.language ? { language: update.language } : {}),
            },
          })
        );
        return yield* LaikaTask.runValue(this.getDocument(update.key));
      })
    );
  }

  deleteDocument(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        const qb = this.options.documentQueryBuilders;
        yield* Effect.promise(() => this.options.callbacks.documents.delete({ where: qb.keyEquals(key) }));
      })
    );
  }

  getUnpublished(key: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const qb = this.options.documentQueryBuilders;
        const rows = yield* Effect.promise(() =>
          this.options.callbacks.documents.select({
            where: qb.and(qb.keyEquals(key), qb.statusNotEquals(PUBLISHED_STATUS)),
            limit: 1,
          })
        );
        if (rows.length === 0) {
          return yield* Effect.fail(new NotFoundError(`Unpublished document not found: ${key}`));
        }
        const row = rows[0]!;
        const content = yield* parseContent(row.content);
        return {
          type: 'unpublished' as const,
          key: row.key,
          status: row.status ?? 'published',
          language: row.language ?? 'unk',
          content,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      })
    );
  }

  createUnpublished(create: UnpublishedCreate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const now = new Date().toISOString();
        yield* Effect.promise(() =>
          this.options.callbacks.documents.insert({
            values: {
              key: create.key,
              depth: pathToSegments(create.key).length,
              status: create.status,
              language: create.language,
              content: JSON.stringify(create.content),
              createdAt: now,
              updatedAt: now,
            },
          })
        );
        return yield* LaikaTask.runValue(this.getUnpublished(create.key));
      })
    );
  }

  updateUnpublished(update: UnpublishedUpdate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const qb = this.options.documentQueryBuilders;
        const now = new Date().toISOString();
        const values: Partial<DocumentModelStrict> = {
          updatedAt: now,
          language: update.language ?? 'unk',
        };
        if (update.status) values.status = update.status;
        if (update.content) values.content = JSON.stringify(update.content);
        yield* Effect.promise(() =>
          this.options.callbacks.documents.update({
            where: qb.and(qb.keyEquals(update.key), qb.statusNotEquals(PUBLISHED_STATUS)),
            values,
          })
        );
        return yield* LaikaTask.runValue(this.getUnpublished(update.key));
      })
    );
  }

  deleteUnpublished(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        const qb = this.options.documentQueryBuilders;
        yield* Effect.promise(() =>
          this.options.callbacks.documents.delete({
            where: qb.and(qb.keyEquals(key), qb.statusNotEquals(PUBLISHED_STATUS)),
          })
        );
      })
    );
  }

  publish(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        // Verify unpublished exists
        yield* LaikaTask.runValue(this.getUnpublished(key));
        const qb = this.options.documentQueryBuilders;
        const now = new Date().toISOString();
        yield* Effect.promise(() =>
          this.options.callbacks.documents.update({
            where: qb.keyEquals(key),
            values: { status: PUBLISHED_STATUS, updatedAt: now },
          })
        );
        return yield* LaikaTask.runValue(this.getDocument(key));
      })
    );
  }

  unpublish(key: string, status: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        // Verify document exists
        yield* LaikaTask.runValue(this.getDocument(key));
        const qb = this.options.documentQueryBuilders;
        const now = new Date().toISOString();
        yield* Effect.promise(() =>
          this.options.callbacks.documents.update({
            where: qb.keyEquals(key),
            values: { status, updatedAt: now },
          })
        );
        return yield* LaikaTask.runValue(this.getUnpublished(key));
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
        const qb = this.options.documentQueryBuilders;
        const rows = yield* Effect.promise(() =>
          this.options.callbacks.documents.select({
            excludeContent: summaryOnly,
            where: qb.and(...[
              options.type === 'published' ? qb.statusEquals(PUBLISHED_STATUS) : undefined,
              options.type === 'unpublished' ? qb.statusNotEquals(PUBLISHED_STATUS) : undefined,
              options.statuses ? qb.statusIn(options.statuses) : undefined,
              options.folder ? qb.keyStartsWith(options.folder + '/') : undefined,
              options.folder
                ? qb.depthLte(pathToSegments(options.folder).length + options.depth)
                : undefined,
            ].filter((x): x is NonNullable<typeof x> => x !== undefined)),
            offset: 'offset' in options.pagination ? options.pagination.offset : 0,
            limit: 'limit' in options.pagination ? options.pagination.limit : 100,
          })
        );

        let emitted = 0;
        for (const row of rows) {
          if (summaryOnly) {
            yield* emit.data({
              type: options.type === 'published'
                ? 'published'
                : options.type === 'unpublished'
                ? 'unpublished'
                : 'record',
              key: row.key,
              status: PUBLISHED_STATUS,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            } as T);
            emitted += 1;
            continue;
          }
          const parsed = yield* Effect.result(parseContent(row.content));
          if (parsed._tag === 'Failure') {
            yield* emit.recoverableError(parsed.failure);
            continue;
          }
          yield* emit.data({
            type: options.type === 'published'
              ? 'published'
              : options.type === 'unpublished'
              ? 'unpublished'
              : 'record',
            key: row.key,
            status: PUBLISHED_STATUS,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            content: parsed.success,
          } as T);
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  getRevision(key: string, revision: string): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.make<Revision>(() =>
      Effect.gen({ self: this }, function*() {
        const qb = this.options.revisionQueryBuilders;
        const rows = yield* Effect.promise(() =>
          this.options.callbacks.revisions.select({
            where: qb.and(qb.keyEquals(key), qb.revisionEquals(revision)),
            limit: 1,
          })
        );
        if (rows.length === 0) {
          return yield* Effect.fail(new NotFoundError(`Revision not found: ${key}/${revision}`));
        }
        const row = rows[0]!;
        const content = yield* parseContent(row.content);
        return {
          type: 'revision' as const,
          key: row.key,
          revision: row.revision,
          language: row.language ?? 'unk',
          content,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      })
    );
  }

  createRevision(create: RevisionCreate): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.make<Revision>(() =>
      Effect.gen({ self: this }, function*() {
        const now = new Date().toISOString();
        yield* Effect.promise(() =>
          this.options.callbacks.revisions.insert({
            values: {
              key: create.key,
              depth: pathToSegments(create.key).length,
              revision: create.revision,
              language: create.language,
              content: JSON.stringify(create.content),
              createdAt: now,
              updatedAt: now,
            },
          })
        );
        return yield* LaikaTask.runValue(this.getRevision(create.key, create.revision));
      })
    );
  }

  listRevisions(
    key: string,
    _options: ListRevisionsOptions,
  ): LaikaStream.LaikaStream<RevisionSummary, ListRevisionsDone> {
    return LaikaStream.make<RevisionSummary, ListRevisionsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const qb = this.options.revisionQueryBuilders;
        const rows = yield* Effect.promise(() => this.options.callbacks.revisions.select({ where: qb.keyEquals(key) }));
        for (const row of rows) {
          yield* emit.data({
            type: 'revision-summary' as const,
            key,
            revision: row.revision,
            language: row.language ?? 'unk',
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          });
        }
        return { total: rows.length };
      })
    );
  }
}
