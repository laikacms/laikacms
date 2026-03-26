import {
  eq,
  and,
  inArray,
  ne,
  Column,
  InferModelFromColumns,
  ColumnBaseConfig,
  SQL,
  or,
  like,
  lt,
  lte,
} from "drizzle-orm";
import {
  Result,
  success,
  failure,
  NotFoundError,
  Logger,
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

const PUBLISHED_STATUS = "published";

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
  logger?: Logger;
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

  async getDocument(key: string): Promise<Result<Document>> {
    const cols = this.options.documentColumns;
    const rows = await this.options.callbacks.documents.select({
      where: and(eq(cols.key, key), eq(cols.status, PUBLISHED_STATUS)),
      limit: 1,
    });
    if (rows.length === 0)
      return failure(NotFoundError.CODE, [`Document not found: ${key}`]);
    const row = rows[0];
    try {
      const content = JSON.parse(
        String(this.getDocValue(row, "content")),
      ) as StorageObjectContent;
      return success({
        type: "published",
        key: String(this.getDocValue(row, "key")),
        status: PUBLISHED_STATUS,
        content,
        createdAt: String(this.getDocValue(row, "createdAt")),
        updatedAt: String(this.getDocValue(row, "updatedAt")),
      });
    } catch (error) {
      return failure(InvalidData.CODE, [
        `Invalid JSON content format: ${error instanceof Error ? error.message : "Unknown error"}`,
      ]);
    }
  }

  async createDocument(create: DocumentCreate): Promise<Result<Document>> {
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
    return this.getDocument(create.key);
  }

  async updateDocument(update: DocumentCreate): Promise<Result<Document>> {
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
    return this.getDocument(update.key);
  }

  async deleteDocument(key: string): Promise<Result<void>> {
    const cols = this.options.documentColumns;
    await this.options.callbacks.documents.delete({
      where: and(eq(cols.key, key)),
    });
    return success(undefined);
  }

  async getUnpublished(key: string): Promise<Result<Unpublished>> {
    const cols = this.options.documentColumns;
    const rows = await this.options.callbacks.documents.select({
      where: and(eq(cols.key, key), ne(cols.status, PUBLISHED_STATUS)),
      limit: 1,
    });
    if (rows.length === 0)
      return failure(NotFoundError.CODE, [
        `Unpublished document not found: ${key}`,
      ]);
    const row = rows[0];
    try {
      const content = JSON.parse(
        String(this.getDocValue(row, "content")),
      ) as StorageObjectContent;
      return success({
        type: "unpublished",
        key: String(this.getDocValue(row, "key")),
        status: String(this.getDocValue(row, "status")),
        content,
        createdAt: String(this.getDocValue(row, "createdAt")),
        updatedAt: String(this.getDocValue(row, "updatedAt")),
      });
    } catch (error) {
      return failure(InvalidData.CODE, [
        `Invalid JSON content format: ${error instanceof Error ? error.message : "Unknown error"}`,
      ]);
    }
  }

  async createUnpublished(
    create: UnpublishedCreate,
  ): Promise<Result<Unpublished>> {
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
    return this.getUnpublished(create.key);
  }

  async updateUnpublished(
    update: UnpublishedUpdate,
  ): Promise<Result<Unpublished>> {
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
    return this.getUnpublished(update.key);
  }

  async deleteUnpublished(key: string): Promise<Result<void>> {
    const cols = this.options.documentColumns;
    await this.options.callbacks.documents.delete({
      where: and(
        eq(cols.key, key),
        eq(cols.key, key),
        ne(cols.status, PUBLISHED_STATUS),
      ),
    });
    return success(undefined);
  }

  async publish(key: string): Promise<Result<Document>> {
    const unpublishedResult = await this.getUnpublished(key);
    if (!unpublishedResult.success) return unpublishedResult;
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
    return this.getDocument(key);
  }

  async unpublish(key: string, status: string): Promise<Result<Unpublished>> {
    const documentResult = await this.getDocument(key);
    if (!documentResult.success) return documentResult;
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
    return this.getUnpublished(key);
  }

  private async *listRecordsInternal<
    SummaryOnly extends boolean,
    T extends SummaryOnly extends true ? RecordSummary : DocumentRecord,
  >(
    options: SummaryOnly extends true ? ListRecordsOptions : ListRecordsOptions,
    summaryOnly: SummaryOnly,
  ): AsyncGenerator<Result<readonly T[]>> {
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
        yield failure(InvalidData.CODE, [
          `Invalid JSON content format for document key "${String(this.getDocValue(row, "key"))}": ${error instanceof Error ? error.message : "Unknown error"}`,
        ]);
        return;
      }
    }
    yield success(records);
  }

  listRecords(
    options: ListRecordsOptions,
  ): AsyncGenerator<Result<readonly DocumentRecord[]>> {
    return this.listRecordsInternal(options, false);
  }

  listRecordSummaries(
    options: ListRecordSummaries,
  ): AsyncGenerator<Result<readonly RecordSummary[]>> {
    return this.listRecordsInternal(options, true);
  }

  async getRevision(key: string, revision: string): Promise<Result<Revision>> {
    const cols = this.options.revisionColumns;
    const rows = await this.options.callbacks.revisions.select({
      where: and(eq(cols.key, key), eq(cols.revision, revision)),
      limit: 1,
    });
    if (rows.length === 0)
      return failure(NotFoundError.CODE, [
        `Revision not found: ${key}/${revision}`,
      ]);
    const row = rows[0];
    try {
      const content = JSON.parse(
        String(this.getRevValue(row, "content")),
      ) as StorageObjectContent;
      return success({
        type: "revision",
        key: String(this.getRevValue(row, "key")),
        revision: String(this.getRevValue(row, "revision")),
        content,
        createdAt: String(this.getRevValue(row, "createdAt")),
        updatedAt: String(this.getRevValue(row, "updatedAt")),
      });
    } catch (error) {
      return failure(InvalidData.CODE, [
        `Invalid JSON content format: ${error instanceof Error ? error.message : "Unknown error"}`,
      ]);
    }
  }

  async createRevision(create: RevisionCreate): Promise<Result<Revision>> {
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
    return this.getRevision(create.key, create.revision);
  }

  async *listRevisions(
    key: string,
    _options: ListRevisionsOptions,
  ): AsyncGenerator<Result<readonly RevisionSummary[]>> {
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
    yield success(summaries);
  }
}
