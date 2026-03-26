import {
  EntryAlreadyExistsError,
  failure,
  InvalidData,
  Logger,
  NotFoundError,
  Result,
  success
} from "@laikacms/core";
import {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  ListAtomsOptions,
  pathCombine,
  StorageObject,
  StorageObjectContent,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageRepository
} from "@laikacms/storage";
import {
  and,
  Column,
  ColumnBaseConfig,
  eq,
  InferModelFromColumns,
  like,
  lte,
  SQL,
} from "drizzle-orm";

type ColumnOptions = {
  key: Column<ColumnBaseConfig<"string", any>>;
  type: Column<ColumnBaseConfig<"string", any>>;
  content: Column<ColumnBaseConfig<"string", any>>;
  depth: Column<ColumnBaseConfig<"number", any>>;
  createdAt: Column<ColumnBaseConfig<"string", any>>;
  updatedAt: Column<ColumnBaseConfig<"string", any>>;
};

export type DrizzleStorageCallbacks<Model> = {
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
  }) => Promise<Model[]>;
};

export interface DrizzleStorageRepositoryOptions<Columns, Model> {
  logger?: Logger | undefined;
  columns: Columns;
  callbacks: DrizzleStorageCallbacks<Model>;
}

export class DrizzleStorageRepository<
  Columns extends ColumnOptions,
  Model extends InferModelFromColumns<Columns, "select">,
> extends StorageRepository {
  constructor(
    private options: DrizzleStorageRepositoryOptions<Columns, Model>,
  ) {
    super();
  }

  getValue<K extends keyof Columns & ("key" | "type" | "content" | "depth" | "createdAt" | "updatedAt")>(
    row: Model,
    key: K,
  ): Model[K] {
    // Access using the TypeScript property name (key), not the database column name
    return row[key];
  }

  private calculateDepth(key: string): number {
    return key.split("/").length;
  }

  async *removeAtoms(
    keys: readonly string[],
  ): AsyncGenerator<Result<readonly string[]>> {
    for (const key of keys) {
      await this.options.callbacks.delete({
        where: eq(this.options.columns.key, key),
      });
    }
    yield success([...keys]);
  }

  async getFolder(key: string): Promise<Result<Folder>> {
    const objects = await this.options.callbacks.select({
      where: like(this.options.columns.key, `${key}/%`),
      limit: 1,
    });
    if (objects.length === 0)
      return failure(NotFoundError.CODE, [`Folder not found: ${key}`]);
    const now = new Date().toISOString();
    return success({ type: "folder", key, createdAt: now, updatedAt: now });
  }

  async getAtom(key: string): Promise<Result<Atom>> {
    const objectResult = await this.getObject(key);
    if (objectResult.success) return objectResult;
    return this.getFolder(key);
  }

  async getObject(key: string): Promise<Result<StorageObject>> {
    const rows = await this.options.callbacks.select({
      where: eq(this.options.columns.key, key),
      limit: 1,
    });
    if (rows.length === 0)
      return failure(NotFoundError.CODE, [`Object not found: ${key}`]);
    const row = rows[0];
    const contentRaw = this.getValue(row, "content");

    try {
      const content = JSON.parse(String(contentRaw));
      return success({
        type: "object",
        key: String(this.getValue(row, "key")),
        createdAt: String(this.getValue(row, "createdAt")),
        updatedAt: String(this.getValue(row, "updatedAt")),
        content,
      });
    } catch (error) {
      return failure(InvalidData.CODE, [
        `Invalid JSON content format: ${error instanceof Error ? error.message : "Unknown error"}`,
      ]);
    }
  }

  async updateObject(
    update: StorageObjectUpdate,
  ): Promise<Result<StorageObject>> {
    const now = new Date().toISOString();
    if (update.content !== undefined) {
      const model = {
        content: JSON.stringify(update.content),
        updatedAt: now,
      } as Partial<Model>;
      await this.options.callbacks.update({
        where: eq(this.options.columns.key, update.key),
        values: model,
      });
    }
    return this.getObject(update.key);
  }

  async createObject(
    create: StorageObjectCreate,
  ): Promise<Result<StorageObject>> {
    if (!create.content)
      return failure(InvalidData.CODE, [
        "Object content is required for creation",
      ]);
    const exists = await this.options.callbacks.select({
      where: eq(this.options.columns.key, create.key),
    });
    if (exists.length > 0 && exists[0]) {
      return failure(EntryAlreadyExistsError.CODE, [
        `An object with key "${create.key}" already exists`,
      ]);
    }
    const now = new Date().toISOString();
    const values = {
      key: create.key,
      type: create.type,
      content: JSON.stringify(create.content),
      depth: this.calculateDepth(create.key),
      createdAt: now,
      updatedAt: now,
    } as Model;
    await this.options.callbacks.insert({
      where: eq(this.options.columns.key, create.key),
      values,
    });
    return this.getObject(create.key);
  }

  async createOrUpdateObject(
    create: StorageObjectCreate,
  ): Promise<Result<StorageObject>> {
    if (!create.content)
      return failure(InvalidData.CODE, ["Object content is required"]);
    const exists = await this.options.callbacks.select({
      where: eq(this.options.columns.key, create.key),
    });
    if (exists.length > 0) {
      return this.updateObject({ key: create.key, content: create.content });
    }
    return this.createObject(create);
  }

  async createFolder(folderCreate: FolderCreate): Promise<Result<Folder>> {
    const keepKey = pathCombine(folderCreate.key, ".keep");
    const now = new Date().toISOString();
    const values = {
      key: keepKey,
      type: "keep-file",
      content: "",
      depth: this.calculateDepth(keepKey),
      createdAt: now,
      updatedAt: now,
    } as Model;
    await this.options.callbacks.insert({
      where: eq(this.options.columns.key, keepKey),
      values,
    });
    return this.getFolder(folderCreate.key);
  }

  async *listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): AsyncGenerator<Result<readonly AtomSummary[]>> {
    for await (const result of this.listAtoms(folderKey, options)) {
      if (!result.success) {
        yield result;
        return;
      }
      const summaries: AtomSummary[] = result.data.map((atom) => ({
        type: "object-summary" as const,
        key: atom.key,
      }));
      yield success(summaries);
    }
  }

  async *listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): AsyncGenerator<Result<readonly Atom[]>> {
    const pattern = folderKey ? `${folderKey}/%` : "%";
    const baseDepth = folderKey ? this.calculateDepth(folderKey) : 0;
    const maxDepth = baseDepth + options.depth;

    const limit = "limit" in options.pagination ? options.pagination.limit : 20;
    const objects = await this.options.callbacks.select({
      where: and(
        like(this.options.columns.key, pattern),
        lte(this.options.columns.depth, maxDepth),
      ),
      limit: limit,
    });
    const atoms: Atom[] = [];
    for (const obj of objects) {
      const key = String(this.getValue(obj, "key"));
      try {
        const contentRaw = this.getValue(obj, "content");
        const content = JSON.parse(String(contentRaw)) as StorageObjectContent;
        atoms.push({
          type: "object",
          key,
          createdAt: String(this.getValue(obj, "createdAt")),
          updatedAt: String(this.getValue(obj, "updatedAt")),
          content,
        });
      } catch (error) {
        yield failure(InvalidData.CODE, [
          `Invalid JSON content format for key "${key}": ${error instanceof Error ? error.message : "Unknown error"}`,
        ]);
        return;
      }
    }
    yield success(atoms);
  }
}
