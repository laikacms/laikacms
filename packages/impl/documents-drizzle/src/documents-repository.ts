import {
  eq,
  and,
  inArray,
  ne,
  Column,
  InferModelFromColumns,
  ColumnBaseConfig,
  SQL,
  like,
  lte,
} from "drizzle-orm";
import {
  LaikaError,
  LaikaResult,
  NotFoundError,
  InvalidData,
} from "@laikacms/core";
import { StorageObjectContent } from "@laikacms/storage";
import {
  Revision,
  Document,
  Unpublished,
  UnpublishedCreate,
  UnpublishedUpdate,
  Record as DocumentRecord,
  DocumentsRepository,
  RevisionSummary,
  ListRevisionsOptions,
  ListRecordsOptions,
  RecordSummary,
  DocumentCreate,
  RevisionCreate,
  pathToSegments,
  ListRecordSummaries,
} from "@laikacms/documents";
import * as Result from 'effect/Result';

const PUBLISHED_STATUS = "published";

/**
 * Helper to convert a failure result to a different type while preserving the error
 */
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

type DocumentColumnOptions = {
  key: Column<ColumnBaseConfig<"string", string>>;
  depth: Column<ColumnBaseConfig<"number", string>>;
  status: Column<ColumnBaseConfig<"string", string>>;
  content: Column<ColumnBaseConfig<"string", string>>;
  createdAt: Column<ColumnBaseConfig<"string", string>>;
  updatedAt: Column<ColumnBaseConfig<"string", string>>;
};

type RevisionColumnOptions = {
  key: Column<ColumnBaseConfig<"string", string>>;
  depth: Column<ColumnBaseConfig<"number", string>>;
  revision: Column<ColumnBaseConfig<"string", string>>;
  content: Column<ColumnBaseConfig<"string", string>>;
  createdAt: Column<ColumnBaseConfig<"string", string>>;
  updatedAt: Column<ColumnBaseConfig<"string", string>>;
};

export type DrizzleDocumentCallbacks<Model> = {
  insert: (query: {
    where: SQL | undefined;
    values: Model;
  }) => Promise<Model[]>;
  update: (query: {
    where: SQL | undefined;
    values: Partial<Model>;
  }) => Promise<Model[]>;
  delete: (query: { where: SQL | undefined }) => Promise<Model[]>;
  select: (query: {
    where: SQL | undefined;
    excludeContent?: boolean;
    limit?: number;
    offset?: number;
  }) => Promise<Model[]>;
};

export type DrizzleRevisionCallbacks<Model> = {
  insert: (query: {
    where: SQL | undefined;
    values: Model;
  }) => Promise<Model[]>;
  update: (query: {
    where: SQL | undefined;
    values: Partial<Model>;
  }) => Promise<Model[]>;
  delete: (query: { where: SQL | undefined }) => Promise<Model[]>;
  select: (query: {
    where: SQL | undefined;
    limit?: number;
    excludeContent?: boolean;
  }) => Promise<Model[]>;
};

export type DrizzleDocumentsCallbacks<DocModel, RevModel> = {
  documents: DrizzleDocumentCallbacks<DocModel>;
  revisions: DrizzleRevisionCallbacks<RevModel>;
};

export interface DrizzleDocumentsRepositoryOptions<
  DocColumns,
  DocModel,
  RevColumns,
  RevModel,
> {
  logger?: Console;
  documentColumns: DocColumns;
  revisionColumns: RevColumns;
  callbacks: DrizzleDocumentsCallbacks<DocModel, RevModel>;
}

export class DrizzleDocumentsRepository<
  DocColumns extends DocumentColumnOptions,
  DocModel extends InferModelFromColumns<DocColumns, "select">,
  RevColumns extends RevisionColumnOptions,
  RevModel extends InferModelFromColumns<RevColumns, "select">,
> extends DocumentsRepository {
  constructor(
    private options: DrizzleDocumentsRepositoryOptions<
      DocColumns,
      DocModel,
      RevColumns,
      RevModel
    >,
  ) {
    super();
  }

  private getDocValue<
    K extends keyof DocColumns &
      ("key" | "status" | "content" | "createdAt" | "updatedAt"),
  >(row: DocModel, key: K): DocModel[K] {
    return row[key];
  }

  private getRevValue<
    K extends keyof RevColumns &
      ("key" | "revision" | "content" | "createdAt" | "updatedAt"),
  >(row: RevModel, key: K): RevModel[K] {
    return row[key];
  }

  async *getDocument(key: string): AsyncGenerator<LaikaResult<Document>> {
    const cols = this.options.documentColumns;
    const rows = await this.options.callbacks.documents.select({
      where: and(eq(cols.key, key), eq(cols.status, PUBLISHED_STATUS)),
      limit: 1,
    });
    if (rows.length === 0) {
      yield Result.fail(new NotFoundError(`Document not found: ${key}`));
      return;
    }
    const row = rows[0];
    try {
      const content = JSON.parse(
        String(this.getDocValue(row, "content")),
      ) as StorageObjectContent;
      yield Result.succeed({
        type: "published" as const,
        key: String(this.getDocValue(row, "key")),
        status: "published" as const,
        content,
        createdAt: String(this.getDocValue(row, "createdAt")),
        updatedAt: String(this.getDocValue(row, "updatedAt")),
      });
    } catch (error) {
      yield Result.fail(new InvalidData(
        `Invalid JSON content format: ${error instanceof Error ? error.message : "Unknown error"}`
      ));
    }
  }

  async *createDocument(create: DocumentCreate): AsyncGenerator<LaikaResult<Document>> {
    const cols = this.options.documentColumns;
    const now = new Date().toISOString();
    const values = {
      key: create.key,
      depth: pathToSegments(create.key).length,
      status: PUBLISHED_STATUS,
      content: JSON.stringify(create.content),
      createdAt: now,
      updatedAt: now,
    } as DocModel;
    await this.options.callbacks.documents.insert({
      where: eq(cols.key, create.key),
      values,
    });
    yield* this.getDocument(create.key);
  }

  async *updateDocument(update: DocumentCreate): AsyncGenerator<LaikaResult<Document>> {
    const cols = this.options.documentColumns;
    const now = new Date().toISOString();
    const values: Partial<DocModel> = {
      updatedAt: now,
      content: JSON.stringify(update.content),
    } as Partial<DocModel>;
    await this.options.callbacks.documents.update({
      where: and(eq(cols.key, update.key), eq(cols.status, PUBLISHED_STATUS)),
      values,
    });
    yield* this.getDocument(update.key);
  }

  async *deleteDocument(key: string): AsyncGenerator<LaikaResult<void>> {
    const cols = this.options.documentColumns;
    await this.options.callbacks.documents.delete({
      where: and(eq(cols.key, key)),
    });
    yield Result.succeed(undefined);
  }

  async *getUnpublished(key: string): AsyncGenerator<LaikaResult<Unpublished>> {
    const cols = this.options.documentColumns;
    const rows = await this.options.callbacks.documents.select({
      where: and(eq(cols.key, key), ne(cols.status, PUBLISHED_STATUS)),
      limit: 1,
    });
    if (rows.length === 0) {
      yield Result.fail(new NotFoundError(`Unpublished document not found: ${key}`));
      return;
    }
    const row = rows[0];
    try {
      const content = JSON.parse(
        String(this.getDocValue(row, "content")),
      ) as StorageObjectContent;
      yield Result.succeed({
        type: "unpublished" as const,
        key: String(this.getDocValue(row, "key")),
        status: String(this.getDocValue(row, "status")),
        content,
        createdAt: String(this.getDocValue(row, "createdAt")),
        updatedAt: String(this.getDocValue(row, "updatedAt")),
      });
    } catch (error) {
      yield Result.fail(new InvalidData(
        `Invalid JSON content format: ${error instanceof Error ? error.message : "Unknown error"}`
      ));
    }
  }

  async *createUnpublished(
    create: UnpublishedCreate,
  ): AsyncGenerator<LaikaResult<Unpublished>> {
    const cols = this.options.documentColumns;
    const now = new Date().toISOString();
    const values = {
      key: create.key,
      depth: pathToSegments(create.key).length,
      status: create.status,
      content: JSON.stringify(create.content),
      createdAt: now,
      updatedAt: now,
    } as DocModel;
    await this.options.callbacks.documents.insert({
      where: eq(cols.key, create.key),
      values,
    });
    yield* this.getUnpublished(create.key);
  }

  async *updateUnpublished(
    update: UnpublishedUpdate,
  ): AsyncGenerator<LaikaResult<Unpublished>> {
    const cols = this.options.documentColumns;
    const now = new Date().toISOString();
    const values: Partial<DocModel> = {
      updatedAt: now,
    } as Partial<DocModel>;
    if (update.status)
      (values as Record<string, unknown>).status = update.status;
    if (update.content)
      (values as Record<string, unknown>).content = JSON.stringify(
        update.content,
      );
    await this.options.callbacks.documents.update({
      where: and(eq(cols.key, update.key), ne(cols.status, PUBLISHED_STATUS)),
      values,
    });
    yield* this.getUnpublished(update.key);
  }

  async *deleteUnpublished(key: string): AsyncGenerator<LaikaResult<void>> {
    const cols = this.options.documentColumns;
    await this.options.callbacks.documents.delete({
      where: and(
        eq(cols.key, key),
        eq(cols.key, key),
        ne(cols.status, PUBLISHED_STATUS),
      ),
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

    const cols = this.options.documentColumns;
    const now = new Date().toISOString();
    const values = {
      status: PUBLISHED_STATUS,
      updatedAt: now,
    } as Partial<DocModel>;
    await this.options.callbacks.documents.update({
      where: eq(cols.key, key),
      values,
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

    const cols = this.options.documentColumns;
    const now = new Date().toISOString();
    const values = {
      status,
      updatedAt: now,
    } as Partial<DocModel>;
    await this.options.callbacks.documents.update({
      where: eq(cols.key, key),
      values,
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
    const cols = this.options.documentColumns;
    const records: T[] = [];

    const rows = await this.options.callbacks.documents.select({
      excludeContent: summaryOnly,
      where: and(
        options.type === "published" ? eq(cols.status, PUBLISHED_STATUS) : undefined,
        options.type === "unpublished" ? ne(cols.status, PUBLISHED_STATUS) : undefined,
        options.statuses
          ? inArray(cols.status, options.statuses)
          : undefined,
        options.folder ? like(cols.key, options.folder + "/%") : undefined,
        options.folder ? lte(cols.depth, pathToSegments(options.folder).length + options.depth) : undefined,
      ),
      offset: 'offset' in options.pagination ? options.pagination.offset : 0,
      limit: 'limit' in options.pagination ? options.pagination.limit : 100,
    });
    for (const row of rows) {
      try {
        records.push({
          type: options.type === "published" ? "published" : options.type === "unpublished" ? "unpublished" : "record",
          key: String(this.getDocValue(row, "key")),
          status: PUBLISHED_STATUS,
          createdAt: String(this.getDocValue(row, "createdAt")),
          updatedAt: String(this.getDocValue(row, "updatedAt")),

          ...(summaryOnly
            ? {}
            : {
                content: JSON.parse(
                  String(this.getDocValue(row, "content")),
                ) as StorageObjectContent,
              }),
        } as T);
      } catch (error) {
        yield Result.fail(new InvalidData(
          `Invalid JSON content format for document key "${String(this.getDocValue(row, "key"))}": ${error instanceof Error ? error.message : "Unknown error"}`
        ));
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
    const cols = this.options.revisionColumns;
    const rows = await this.options.callbacks.revisions.select({
      where: and(eq(cols.key, key), eq(cols.revision, revision)),
      limit: 1,
    });
    if (rows.length === 0) {
      yield Result.fail(new NotFoundError(`Revision not found: ${key}/${revision}`));
      return;
    }
    const row = rows[0];
    try {
      const content = JSON.parse(
        String(this.getRevValue(row, "content")),
      ) as StorageObjectContent;
      yield Result.succeed({
        type: "revision" as const,
        key: String(this.getRevValue(row, "key")),
        revision: String(this.getRevValue(row, "revision")),
        content,
        createdAt: String(this.getRevValue(row, "createdAt")),
        updatedAt: String(this.getRevValue(row, "updatedAt")),
      });
    } catch (error) {
      yield Result.fail(new InvalidData(
        `Invalid JSON content format: ${error instanceof Error ? error.message : "Unknown error"}`
      ));
    }
  }

  async *createRevision(create: RevisionCreate): AsyncGenerator<LaikaResult<Revision>> {
    const cols = this.options.revisionColumns;
    const now = new Date().toISOString();
    const values = {
      key: create.key,
      depth: pathToSegments(create.key).length,
      revision: create.revision,
      content: JSON.stringify(create.content),
      createdAt: now,
      updatedAt: now,
    } as RevModel;
    await this.options.callbacks.revisions.insert({
      where: and(eq(cols.key, create.key), eq(cols.revision, create.revision)),
      values,
    });
    yield* this.getRevision(create.key, create.revision);
  }

  async *listRevisions(
    key: string,
    _options: ListRevisionsOptions,
  ): AsyncGenerator<LaikaResult<readonly RevisionSummary[]>> {
    const cols = this.options.revisionColumns;
    const rows = await this.options.callbacks.revisions.select({
      where: eq(cols.key, key),
    });
    const summaries: RevisionSummary[] = rows.map((row) => ({
      type: "revision-summary" as const,
      key,
      revision: String(this.getRevValue(row, "revision")),
      createdAt: String(this.getRevValue(row, "createdAt")),
      updatedAt: String(this.getRevValue(row, "updatedAt")),
    }));
    yield Result.succeed(summaries);
  }
}
