import type { LaikaError, LaikaResult} from '@laikacms/core';
import { InvalidData, NotFoundError } from '@laikacms/core';
import type {
  Document,
  DocumentCreate,
  ListRecordsOptions,
  ListRecordSummaries,
  ListRevisionsOptions,
  Record as DocumentRecord,
  RecordSummary,
  Revision,
  RevisionCreate,
  RevisionSummary,
  Unpublished,
  UnpublishedCreate,
  UnpublishedUpdate} from '@laikacms/documents';
import {
  DocumentsRepository,
  pathToSegments
} from '@laikacms/documents';
import type { StorageObjectContent } from '@laikacms/storage';
import * as Result from 'effect/Result';

const PUBLISHED_STATUS = 'published';

function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

export type DocumentModel = {
  key: string,
  depth: number,
  status: string,
  content: string,
  createdAt: string,
  updatedAt: string,
};

export type RevisionModel = {
  key: string,
  depth: number,
  revision: string,
  content: string,
  createdAt: string,
  updatedAt: string,
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
      insert: (query: {
        values: DocumentModel,
      }) => Promise<DocumentModel[]>,
      update: (query: {
        where: CKE | CSNE | CSE | CKSW | CSI | CDLTE | CA,
        values: Partial<DocumentModel>,
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
      insert: (query: {
        values: RevisionModel,
      }) => Promise<RevisionModel[]>,
      update: (query: {
        where: RKE | RE | RA,
        values: Partial<RevisionModel>,
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

export class DrizzleDocumentsRepository<CKE, CKSW, CSE, CSNE, CSI, CDLTE, CA, /* Revisions */ RKE, RE, RA>
  extends DocumentsRepository
{
  constructor(
    private options: DrizzleDocumentsRepositoryOptions<CKE, CKSW, CSE, CSNE, CSI, CDLTE, CA, RKE, RE, RA>,
  ) {
    super();
  }

  async *getDocument(key: string): AsyncGenerator<LaikaResult<Document>> {
    const qb = this.options.documentQueryBuilders;
    const rows = await this.options.callbacks.documents.select({
      where: qb.and(qb.keyEquals(key), qb.statusEquals(PUBLISHED_STATUS)),
      limit: 1,
    });
    if (rows.length === 0) {
      yield Result.fail(new NotFoundError(`Document not found: ${key}`));
      return;
    }
    const row = rows[0];
    try {
      const content = JSON.parse(row.content) as StorageObjectContent;
      yield Result.succeed({
        type: 'published' as const,
        key: row.key,
        status: 'published' as const,
        content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    } catch (error) {
      yield Result.fail(
        new InvalidData(
          `Invalid JSON content format: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ),
      );
    }
  }

  async *createDocument(create: DocumentCreate): AsyncGenerator<LaikaResult<Document>> {
    const now = new Date().toISOString();
    await this.options.callbacks.documents.insert({
      values: {
        key: create.key,
        depth: pathToSegments(create.key).length,
        status: PUBLISHED_STATUS,
        content: JSON.stringify(create.content),
        createdAt: now,
        updatedAt: now,
      },
    });
    yield* this.getDocument(create.key);
  }

  async *updateDocument(update: DocumentCreate): AsyncGenerator<LaikaResult<Document>> {
    const qb = this.options.documentQueryBuilders;
    const now = new Date().toISOString();
    await this.options.callbacks.documents.update({
      where: qb.and(qb.keyEquals(update.key), qb.statusEquals(PUBLISHED_STATUS)),
      values: {
        updatedAt: now,
        content: JSON.stringify(update.content),
      },
    });
    yield* this.getDocument(update.key);
  }

  async *deleteDocument(key: string): AsyncGenerator<LaikaResult<void>> {
    const qb = this.options.documentQueryBuilders;
    await this.options.callbacks.documents.delete({
      where: qb.keyEquals(key),
    });
    yield Result.succeed(undefined);
  }

  async *getUnpublished(key: string): AsyncGenerator<LaikaResult<Unpublished>> {
    const qb = this.options.documentQueryBuilders;
    const rows = await this.options.callbacks.documents.select({
      where: qb.and(qb.keyEquals(key), qb.statusNotEquals(PUBLISHED_STATUS)),
      limit: 1,
    });
    if (rows.length === 0) {
      yield Result.fail(new NotFoundError(`Unpublished document not found: ${key}`));
      return;
    }
    const row = rows[0];
    try {
      const content = JSON.parse(row.content) as StorageObjectContent;
      yield Result.succeed({
        type: 'unpublished' as const,
        key: row.key,
        status: row.status,
        content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    } catch (error) {
      yield Result.fail(
        new InvalidData(
          `Invalid JSON content format: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ),
      );
    }
  }

  async *createUnpublished(
    create: UnpublishedCreate,
  ): AsyncGenerator<LaikaResult<Unpublished>> {
    const now = new Date().toISOString();
    await this.options.callbacks.documents.insert({
      values: {
        key: create.key,
        depth: pathToSegments(create.key).length,
        status: create.status,
        content: JSON.stringify(create.content),
        createdAt: now,
        updatedAt: now,
      },
    });
    yield* this.getUnpublished(create.key);
  }

  async *updateUnpublished(
    update: UnpublishedUpdate,
  ): AsyncGenerator<LaikaResult<Unpublished>> {
    const qb = this.options.documentQueryBuilders;
    const now = new Date().toISOString();
    const values: Partial<DocumentModel> = {
      updatedAt: now,
    };
    if (update.status) values.status = update.status;
    if (update.content) values.content = JSON.stringify(update.content);
    await this.options.callbacks.documents.update({
      where: qb.and(qb.keyEquals(update.key), qb.statusNotEquals(PUBLISHED_STATUS)),
      values,
    });
    yield* this.getUnpublished(update.key);
  }

  async *deleteUnpublished(key: string): AsyncGenerator<LaikaResult<void>> {
    const qb = this.options.documentQueryBuilders;
    await this.options.callbacks.documents.delete({
      where: qb.and(qb.keyEquals(key), qb.statusNotEquals(PUBLISHED_STATUS)),
    });
    yield Result.succeed(undefined);
  }

  async *publish(key: string): AsyncGenerator<LaikaResult<Document>> {
    // Get unpublished first to verify it exists
    let unpublishedExists = false;
    for await (const result of this.getUnpublished(key)) {
      if (Result.isFailure(result)) {
        yield failAs<Document>(result.failure);
        return;
      }
      unpublishedExists = true;
    }
    if (!unpublishedExists) {
      yield Result.fail(new NotFoundError(`Unpublished document not found: ${key}`));
      return;
    }

    const qb = this.options.documentQueryBuilders;
    const now = new Date().toISOString();
    await this.options.callbacks.documents.update({
      where: qb.keyEquals(key),
      values: {
        status: PUBLISHED_STATUS,
        updatedAt: now,
      },
    });
    yield* this.getDocument(key);
  }

  async *unpublish(key: string, status: string): AsyncGenerator<LaikaResult<Unpublished>> {
    // Get document first to verify it exists
    let documentExists = false;
    for await (const result of this.getDocument(key)) {
      if (Result.isFailure(result)) {
        yield failAs<Unpublished>(result.failure);
        return;
      }
      documentExists = true;
    }
    if (!documentExists) {
      yield Result.fail(new NotFoundError(`Document not found: ${key}`));
      return;
    }

    const qb = this.options.documentQueryBuilders;
    const now = new Date().toISOString();
    await this.options.callbacks.documents.update({
      where: qb.keyEquals(key),
      values: {
        status,
        updatedAt: now,
      },
    });
    yield* this.getUnpublished(key);
  }

  private async *listRecordsInternal<
    SummaryOnly extends boolean,
    T extends SummaryOnly extends true ? RecordSummary : DocumentRecord,
  >(
    options: SummaryOnly extends true ? ListRecordsOptions : ListRecordsOptions,
    summaryOnly: SummaryOnly,
  ): AsyncGenerator<LaikaResult<readonly T[]>> {
    const qb = this.options.documentQueryBuilders;
    const records: T[] = [];

    const rows = await this.options.callbacks.documents.select({
      excludeContent: summaryOnly,
      where: qb.and(...[
        options.type === 'published' ? qb.statusEquals(PUBLISHED_STATUS) : undefined,
        options.type === 'unpublished' ? qb.statusNotEquals(PUBLISHED_STATUS) : undefined,
        options.statuses ? qb.statusIn(options.statuses) : undefined,
        options.folder ? qb.keyStartsWith(options.folder + '/') : undefined,
        options.folder ? qb.depthLte(pathToSegments(options.folder).length + options.depth) : undefined,
      ].filter(x => x !== undefined)),
      offset: 'offset' in options.pagination ? options.pagination.offset : 0,
      limit: 'limit' in options.pagination ? options.pagination.limit : 100,
    });
    for (const row of rows) {
      try {
        records.push({
          type: options.type === 'published' ? 'published' : options.type === 'unpublished' ? 'unpublished' : 'record',
          key: row.key,
          status: PUBLISHED_STATUS,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          ...(summaryOnly ? {} : { content: JSON.parse(row.content) as StorageObjectContent }),
        } as T);
      } catch (error) {
        yield Result.fail(
          new InvalidData(
            `Invalid JSON content format for document key "${row.key}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          ),
        );
        return;
      }
    }
    yield Result.succeed(records);
  }

  listRecords(
    options: ListRecordsOptions,
  ): AsyncGenerator<LaikaResult<readonly DocumentRecord[]>> {
    return this.listRecordsInternal(options, false);
  }

  listRecordSummaries(
    options: ListRecordSummaries,
  ): AsyncGenerator<LaikaResult<readonly RecordSummary[]>> {
    return this.listRecordsInternal(options, true);
  }

  async *getRevision(key: string, revision: string): AsyncGenerator<LaikaResult<Revision>> {
    const qb = this.options.revisionQueryBuilders;
    const rows = await this.options.callbacks.revisions.select({
      where: qb.and(qb.keyEquals(key), qb.revisionEquals(revision)),
      limit: 1,
    });
    if (rows.length === 0) {
      yield Result.fail(new NotFoundError(`Revision not found: ${key}/${revision}`));
      return;
    }
    const row = rows[0];
    try {
      const content = JSON.parse(row.content) as StorageObjectContent;
      yield Result.succeed({
        type: 'revision' as const,
        key: row.key,
        revision: row.revision,
        content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    } catch (error) {
      yield Result.fail(
        new InvalidData(
          `Invalid JSON content format: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ),
      );
    }
  }

  async *createRevision(create: RevisionCreate): AsyncGenerator<LaikaResult<Revision>> {
    const now = new Date().toISOString();
    await this.options.callbacks.revisions.insert({
      values: {
        key: create.key,
        depth: pathToSegments(create.key).length,
        revision: create.revision,
        content: JSON.stringify(create.content),
        createdAt: now,
        updatedAt: now,
      },
    });
    yield* this.getRevision(create.key, create.revision);
  }

  async *listRevisions(
    key: string,
    _options: ListRevisionsOptions,
  ): AsyncGenerator<LaikaResult<readonly RevisionSummary[]>> {
    const qb = this.options.revisionQueryBuilders;
    const rows = await this.options.callbacks.revisions.select({
      where: qb.keyEquals(key),
    });
    const summaries: RevisionSummary[] = rows.map(row => ({
      type: 'revision-summary' as const,
      key,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    yield Result.succeed(summaries);
  }
}
