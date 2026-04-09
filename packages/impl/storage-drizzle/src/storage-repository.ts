import { EntryAlreadyExistsError, InvalidData, LaikaError, LaikaResult, NotFoundError } from '@laikacms/core';
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
  StorageRepository,
} from '@laikacms/storage';
import * as Result from 'effect/Result';

/**
 * Helper to convert a failure result to a different type while preserving the error
 */
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

/**
 * Model type for storage objects - defines the shape of database rows
 */
export type StorageModel = {
  key: string,
  type: string,
  content: string,
  depth: number,
  createdAt: string,
  updatedAt: string,
};

/**
 * Query conditions that the repository needs to build
 * The consumer provides functions that create the actual SQL conditions
 */
export type DrizzleStorageQueryBuilders = {
  /** Build a condition for key equals value */
  keyEquals: (value: string) => unknown,
  /** Build a condition for key starts with prefix (LIKE 'prefix%') */
  keyStartsWith: (prefix: string) => unknown,
  /** Build a condition for depth less than or equal to value */
  depthLte: (value: number) => unknown,
  /** Combine multiple conditions with AND */
  and: (...conditions: unknown[]) => unknown,
};

export type DrizzleStorageCallbacks = {
  insert: (query: {
    values: StorageModel,
  }) => Promise<StorageModel[]>,
  update: (query: {
    where: unknown,
    values: Partial<StorageModel>,
  }) => Promise<StorageModel[]>,
  delete: (query: { where: unknown }) => Promise<StorageModel[]>,
  select: (query: {
    where: unknown,
    limit?: number,
  }) => Promise<StorageModel[]>,
};

export interface DrizzleStorageRepositoryOptions {
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
  queryBuilders: DrizzleStorageQueryBuilders;
  callbacks: DrizzleStorageCallbacks;
}

export class DrizzleStorageRepository extends StorageRepository {
  constructor(
    private options: DrizzleStorageRepositoryOptions,
  ) {
    super();
  }

  private calculateDepth(key: string): number {
    return key.split('/').length;
  }

  async *removeAtoms(
    keys: readonly string[],
  ): AsyncGenerator<LaikaResult<readonly string[]>> {
    for (const key of keys) {
      await this.options.callbacks.delete({
        where: this.options.queryBuilders.keyEquals(key),
      });
    }
    yield Result.succeed([...keys]);
  }

  async *getFolder(key: string): AsyncGenerator<LaikaResult<Folder>> {
    const objects = await this.options.callbacks.select({
      where: this.options.queryBuilders.keyStartsWith(`${key}/`),
      limit: 1,
    });
    if (objects.length === 0) {
      yield Result.fail(new NotFoundError(`Folder not found: ${key}`));
      return;
    }
    const now = new Date().toISOString();
    yield Result.succeed({ type: 'folder' as const, key, createdAt: now, updatedAt: now });
  }

  async *getAtom(key: string): AsyncGenerator<LaikaResult<Atom>> {
    // Try to get as object first
    for await (const objectResult of this.getObject(key)) {
      if (Result.isSuccess(objectResult)) {
        yield objectResult;
        return;
      }
    }
    // If not found as object, try as folder
    yield* this.getFolder(key);
  }

  async *getObject(key: string): AsyncGenerator<LaikaResult<StorageObject>> {
    const rows = await this.options.callbacks.select({
      where: this.options.queryBuilders.keyEquals(key),
      limit: 1,
    });
    if (rows.length === 0) {
      yield Result.fail(new NotFoundError(`Object not found: ${key}`));
      return;
    }
    const row = rows[0];

    try {
      const content = JSON.parse(row.content);
      yield Result.succeed({
        type: 'object' as const,
        key: row.key,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        content,
      });
    } catch (error) {
      yield Result.fail(
        new InvalidData(
          `Invalid JSON content format: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ),
      );
    }
  }

  async *updateObject(
    update: StorageObjectUpdate,
  ): AsyncGenerator<LaikaResult<StorageObject>> {
    const now = new Date().toISOString();
    if (update.content !== undefined) {
      await this.options.callbacks.update({
        where: this.options.queryBuilders.keyEquals(update.key),
        values: {
          content: JSON.stringify(update.content),
          updatedAt: now,
        },
      });
    }
    yield* this.getObject(update.key);
  }

  async *createObject(
    create: StorageObjectCreate,
  ): AsyncGenerator<LaikaResult<StorageObject>> {
    if (!create.content) {
      yield Result.fail(new InvalidData('Object content is required for creation'));
      return;
    }
    const exists = await this.options.callbacks.select({
      where: this.options.queryBuilders.keyEquals(create.key),
    });
    if (exists.length > 0 && exists[0]) {
      yield Result.fail(new EntryAlreadyExistsError(`An object with key "${create.key}" already exists`));
      return;
    }
    const now = new Date().toISOString();
    await this.options.callbacks.insert({
      values: {
        key: create.key,
        type: create.type,
        content: JSON.stringify(create.content),
        depth: this.calculateDepth(create.key),
        createdAt: now,
        updatedAt: now,
      },
    });
    yield* this.getObject(create.key);
  }

  async *createOrUpdateObject(
    create: StorageObjectCreate,
  ): AsyncGenerator<LaikaResult<StorageObject>> {
    if (!create.content) {
      yield Result.fail(new InvalidData('Object content is required'));
      return;
    }
    const exists = await this.options.callbacks.select({
      where: this.options.queryBuilders.keyEquals(create.key),
    });
    if (exists.length > 0) {
      yield* this.updateObject({ key: create.key, content: create.content });
      return;
    }
    yield* this.createObject(create);
  }

  async *createFolder(folderCreate: FolderCreate): AsyncGenerator<LaikaResult<Folder>> {
    const keepKey = pathCombine(folderCreate.key, '.keep');
    const now = new Date().toISOString();
    await this.options.callbacks.insert({
      values: {
        key: keepKey,
        type: 'keep-file',
        content: '',
        depth: this.calculateDepth(keepKey),
        createdAt: now,
        updatedAt: now,
      },
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
        type: 'object-summary' as const,
        key: atom.key,
      }));
      yield Result.succeed(summaries);
    }
  }

  async *listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): AsyncGenerator<LaikaResult<readonly Atom[]>> {
    const pattern = folderKey ? `${folderKey}/` : '';
    const baseDepth = folderKey ? this.calculateDepth(folderKey) : 0;
    const maxDepth = baseDepth + options.depth;

    const limit = 'limit' in options.pagination ? options.pagination.limit : 20;
    const objects = await this.options.callbacks.select({
      where: this.options.queryBuilders.and(
        this.options.queryBuilders.keyStartsWith(pattern),
        this.options.queryBuilders.depthLte(maxDepth),
      ),
      limit: limit,
    });
    const atoms: Atom[] = [];
    for (const obj of objects) {
      try {
        const content = JSON.parse(obj.content) as StorageObjectContent;
        atoms.push({
          type: 'object',
          key: obj.key,
          createdAt: obj.createdAt,
          updatedAt: obj.updatedAt,
          content,
        });
      } catch (error) {
        yield Result.fail(
          new InvalidData(
            `Invalid JSON content format for key "${obj.key}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          ),
        );
        return;
      }
    }
    yield Result.succeed(atoms);
  }
}
