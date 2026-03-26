import {
  EntryAlreadyExistsError,
  LaikaError,
  LaikaResult,
  InvalidData,
  NotFoundError,
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
import * as Result from 'effect/Result';

/**
 * Helper to convert a failure result to a different type while preserving the error
 */
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

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
  logger?: Console | undefined;
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
  ): AsyncGenerator<LaikaResult<readonly string[]>> {
    for (const key of keys) {
      await this.options.callbacks.delete({
        where: eq(this.options.columns.key, key),
      });
    }
    yield Result.succeed([...keys]);
  }

  async *getFolder(key: string): AsyncGenerator<LaikaResult<Folder>> {
    const objects = await this.options.callbacks.select({
      where: like(this.options.columns.key, `${key}/%`),
      limit: 1,
    });
    if (objects.length === 0) {
      yield Result.fail(new NotFoundError(`Folder not found: ${key}`));
      return;
    }
    const now = new Date().toISOString();
    yield Result.succeed({ type: "folder" as const, key, createdAt: now, updatedAt: now });
  }

  async *getAtom(key: string): AsyncGenerator<LaikaResult<Atom>> {
    // Try to get as object first
    let foundObject = false;
    for await (const objectResult of this.getObject(key)) {
      if (Result.isSuccess(objectResult)) {
        yield objectResult;
        return;
      }
      foundObject = true;
    }
    // If not found as object, try as folder
    yield* this.getFolder(key);
  }

  async *getObject(key: string): AsyncGenerator<LaikaResult<StorageObject>> {
    const rows = await this.options.callbacks.select({
      where: eq(this.options.columns.key, key),
      limit: 1,
    });
    if (rows.length === 0) {
      yield Result.fail(new NotFoundError(`Object not found: ${key}`));
      return;
    }
    const row = rows[0];
    const contentRaw = this.getValue(row, "content");

    try {
      const content = JSON.parse(String(contentRaw));
      yield Result.succeed({
        type: "object" as const,
        key: String(this.getValue(row, "key")),
        createdAt: String(this.getValue(row, "createdAt")),
        updatedAt: String(this.getValue(row, "updatedAt")),
        content,
      });
    } catch (error) {
      yield Result.fail(new InvalidData(
        `Invalid JSON content format: ${error instanceof Error ? error.message : "Unknown error"}`
      ));
    }
  }

  async *updateObject(
    update: StorageObjectUpdate,
  ): AsyncGenerator<LaikaResult<StorageObject>> {
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
    yield* this.getObject(update.key);
  }

  async *createObject(
    create: StorageObjectCreate,
  ): AsyncGenerator<LaikaResult<StorageObject>> {
    if (!create.content) {
      yield Result.fail(new InvalidData("Object content is required for creation"));
      return;
    }
    const exists = await this.options.callbacks.select({
      where: eq(this.options.columns.key, create.key),
    });
    if (exists.length > 0 && exists[0]) {
      yield Result.fail(new EntryAlreadyExistsError(`An object with key "${create.key}" already exists`));
      return;
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
    yield* this.getObject(create.key);
  }

  async *createOrUpdateObject(
    create: StorageObjectCreate,
  ): AsyncGenerator<LaikaResult<StorageObject>> {
    if (!create.content) {
      yield Result.fail(new InvalidData("Object content is required"));
      return;
    }
    const exists = await this.options.callbacks.select({
      where: eq(this.options.columns.key, create.key),
    });
    if (exists.length > 0) {
      yield* this.updateObject({ key: create.key, content: create.content });
      return;
    }
    yield* this.createObject(create);
  }

  async *createFolder(folderCreate: FolderCreate): AsyncGenerator<LaikaResult<Folder>> {
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
    yield* this.getFolder(folderCreate.key);
  }

  async *listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): AsyncGenerator<LaikaResult<readonly AtomSummary[]>> {
    for await (const result of this.listAtoms(folderKey, options)) {
      if (Result.isFailure(result)) {
        yield failAs<readonly AtomSummary[]>(result.failure);
        return;
      }
      const summaries: AtomSummary[] = result.success.map((atom: Atom) => ({
        type: "object-summary" as const,
        key: atom.key,
      }));
      yield Result.succeed(summaries);
    }
  }

  async *listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): AsyncGenerator<LaikaResult<readonly Atom[]>> {
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
        yield Result.fail(new InvalidData(
          `Invalid JSON content format for key "${key}": ${error instanceof Error ? error.message : "Unknown error"}`
        ));
        return;
      }
    }
    yield Result.succeed(atoms);
  }
}
