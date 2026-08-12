import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  EntryAlreadyExistsError,
  ForbiddenError,
  InternalError,
  InvalidData,
  type LaikaError,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  ListAtomsDone,
  ListAtomsOptions,
  RemoveAtomsDone,
  StorageObject,
  StorageObjectContent,
  StorageObjectCreate,
  StorageObjectUpdate,
} from 'laikacms/storage';
import { Capabilities, CompatibilityDate, pathCombine, StorageRepository, unsupportedChanges } from 'laikacms/storage';

/**
 * Model type for storage objects — defines the shape of database rows.
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
 * Query conditions that the repository needs to build. The consumer provides
 * functions that create the actual SQL conditions.
 */
export type DrizzleStorageQueryBuilders = {
  keyEquals: (value: string) => unknown,
  keyStartsWith: (prefix: string) => unknown,
  depthLte: (value: number) => unknown,
  and: (...conditions: unknown[]) => unknown,
};

export type DrizzleStorageCallbacks = {
  insert: (query: { values: StorageModel }) => Promise<StorageModel[]>,
  update: (query: { where: unknown, values: Partial<StorageModel> }) => Promise<StorageModel[]>,
  delete: (query: { where: unknown }) => Promise<StorageModel[]>,
  select: (query: { where: unknown, limit?: number, offset?: number }) => Promise<StorageModel[]>,
  /**
   * Optional. Return the total number of rows matching `where` (no LIMIT/OFFSET).
   * When provided, `listAtoms` / `listAtomSummaries` populate `done.total` with the
   * full matching count instead of the page count, enabling correct `meta.total` in
   * JSON:API paginated responses.
   */
  count?: (query: { where: unknown }) => Promise<number>,
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

  private debug(op: string, key?: string): void {
    if (!this.options.logger) return;
    const msg = key !== undefined ? `[storage-drizzle] ${op} key="${key}"` : `[storage-drizzle] ${op}`;
    this.options.logger.debug(msg);
  }

  private calculateDepth(key: string): number {
    return key.split('/').length;
  }

  private parseObjectRow(row: StorageModel): Effect.Effect<StorageObject, LaikaError> {
    return Effect.gen(function*() {
      let content: StorageObjectContent;
      try {
        content = JSON.parse(row.content);
      } catch (error) {
        return yield* Effect.fail(
          new InvalidData(
            `Invalid JSON content format for key "${row.key}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            { translation: { message: 'storage.drizzle.invalidJsonContent' } },
          ),
        );
      }
      return {
        type: 'object' as const,
        key: row.key,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        content,
      } satisfies StorageObject;
    });
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          this.debug('removeAtoms:select-children', key);
          // Pre-check: refuse to delete if this key is a folder prefix (has children).
          // Must happen before the DELETE so a key that exists as both a DB row and a
          // folder prefix is correctly blocked (post-delete check would never fire then).
          const children = yield* Effect.promise(() =>
            this.options.callbacks.select({
              where: this.options.queryBuilders.keyStartsWith(`${key}/`),
              limit: 1,
            })
          );
          if (children.length > 0) {
            yield* emit.recoverableError(
              new ForbiddenError(`Cannot remove folder key via removeAtoms: '${key}'`, {
                translation: { message: 'storage.drizzle.cannotRemoveFolderKey' },
              }),
            );
            skipped += 1;
            continue;
          }

          this.debug('removeAtoms:delete', key);
          const attempt = yield* Effect.result(
            Effect.tryPromise({
              try: () =>
                this.options.callbacks.delete({
                  where: this.options.queryBuilders.keyEquals(key),
                }),
              catch: cause =>
                new InternalError(
                  `Failed to remove "${key}": ${cause instanceof Error ? cause.message : String(cause)}`,
                  { cause, translation: { message: 'storage.drizzle.failedToRemoveAtom' } },
                ),
            }),
          );
          if (Result.isFailure(attempt)) {
            this.options.logger?.error(`[storage-drizzle] removeAtoms failed key="${key}": ${attempt.failure.message}`);
            yield* emit.recoverableError(attempt.failure);
            skipped += 1;
            continue;
          }
          if (attempt.success.length === 0) {
            yield* emit.recoverableError(
              new NotFoundError(`No atom found at key "${key}"`, {
                translation: { message: 'storage.drizzle.atomNotFound' },
              }),
            );
            skipped += 1;
            continue;
          }
          yield* emit.data(key);
          removed += 1;
        }
        return { removed, skipped };
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('getFolder', key);
        const objects = yield* Effect.promise(() =>
          this.options.callbacks.select({
            where: this.options.queryBuilders.keyStartsWith(`${key}/`),
            limit: 1,
          })
        );
        if (objects.length === 0) {
          return yield* Effect.fail(
            new NotFoundError(`Folder not found: ${key}`, {
              translation: { message: 'storage.drizzle.directoryNotFound' },
            }),
          );
        }
        const now = new Date().toISOString();
        return { type: 'folder' as const, key, createdAt: now, updatedAt: now };
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(emit =>
      Effect.gen({ self: this }, function*() {
        const asObject = yield* Effect.result(LaikaTask.runValueForwarding(this.getObject(key), emit));
        if (asObject._tag === 'Success') return asObject.success;
        return yield* LaikaTask.runValueForwarding(this.getFolder(key), emit);
      })
    );
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('getObject', key);
        const rows = yield* Effect.promise(() =>
          this.options.callbacks.select({
            where: this.options.queryBuilders.keyEquals(key),
            limit: 1,
          })
        );
        if (rows.length === 0) {
          return yield* Effect.fail(
            new NotFoundError(`Object not found: ${key}`, {
              translation: { message: 'storage.drizzle.fileNotFound' },
            }),
          );
        }
        return yield* this.parseObjectRow(rows[0]!);
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('updateObject', update.key);
        if (update.content !== undefined) {
          const now = new Date().toISOString();
          yield* Effect.promise(() =>
            this.options.callbacks.update({
              where: this.options.queryBuilders.keyEquals(update.key),
              values: { content: JSON.stringify(update.content), updatedAt: now },
            })
          );
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('createObject', create.key);
        if (!create.content) {
          return yield* Effect.fail(
            new InvalidData('Object content is required for creation', {
              translation: { message: 'storage.drizzle.contentRequired' },
            }),
          );
        }
        const exists = yield* Effect.promise(() =>
          this.options.callbacks.select({
            where: this.options.queryBuilders.keyEquals(create.key),
          })
        );
        if (exists.length > 0 && exists[0]) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(`An object with key "${create.key}" already exists`, {
              translation: { message: 'storage.drizzle.entryAlreadyExists' },
            }),
          );
        }
        const now = new Date().toISOString();
        yield* Effect.promise(() =>
          this.options.callbacks.insert({
            values: {
              key: create.key,
              type: create.type ?? 'object',
              content: JSON.stringify(create.content),
              depth: this.calculateDepth(create.key),
              createdAt: now,
              updatedAt: now,
            },
          })
        );
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(
            new InvalidData('Object content is required', {
              translation: { message: 'storage.drizzle.contentRequired' },
            }),
          );
        }
        const exists = yield* Effect.promise(() =>
          this.options.callbacks.select({
            where: this.options.queryBuilders.keyEquals(create.key),
          })
        );
        if (exists.length > 0) {
          return yield* LaikaTask.runValue(
            this.updateObject({ key: create.key, content: create.content }),
          );
        }
        return yield* LaikaTask.runValue(this.createObject(create));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('createFolder', folderCreate.key);
        const keepKey = pathCombine(folderCreate.key, '.keep');
        const now = new Date().toISOString();
        yield* Effect.promise(() =>
          this.options.callbacks.insert({
            values: {
              key: keepKey,
              type: 'keep-file',
              content: 'null',
              depth: this.calculateDepth(keepKey),
              createdAt: now,
              updatedAt: now,
            },
          })
        );
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    return LaikaStream.make<AtomSummary, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const collected = yield* LaikaStream.runCollect(this.listAtoms(folderKey, options));
        for (const w of collected.recoverableErrors) yield* emit.recoverableError(w);
        for (const atom of collected.data) {
          yield* emit.data({ type: 'object-summary' as const, key: atom.key });
        }
        return collected.done;
      })
    );
  }

  listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        this.debug('listAtoms', folderKey);
        const pattern = folderKey ? `${folderKey}/` : '';
        const baseDepth = folderKey ? this.calculateDepth(folderKey) : 0;
        const maxDepth = baseDepth + options.depth;
        let limit: number | undefined;
        let offset: number;
        if ('page' in options.pagination) {
          const perPage = options.pagination.perPage ?? 20;
          limit = perPage;
          offset = (options.pagination.page - 1) * perPage;
        } else {
          limit = 'limit' in options.pagination ? options.pagination.limit : undefined;
          offset = 'offset' in options.pagination ? options.pagination.offset : 0;
        }

        const where = this.options.queryBuilders.and(
          this.options.queryBuilders.keyStartsWith(pattern),
          this.options.queryBuilders.depthLte(maxDepth),
        );

        const [rows, fullCount] = yield* Effect.all([
          Effect.promise(() => this.options.callbacks.select({ where, limit, offset })),
          this.options.callbacks.count
            ? Effect.promise(() => this.options.callbacks.count!({ where }))
            : Effect.succeed(null),
        ]);

        let emitted = 0;
        for (const row of rows) {
          if (row.type === 'keep-file') continue;
          const parsed = yield* Effect.result(this.parseObjectRow(row));
          if (parsed._tag === 'Failure') {
            yield* emit.recoverableError(parsed.failure);
          } else {
            yield* emit.data(parsed.success);
            emitted += 1;
          }
        }
        return { total: fullCount ?? emitted };
      })
    );
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-11'),
      fileExtensions: {
        supported: false,
        description: 'SQL storage does not have inherent file extensions.',
      },
      pagination: {
        supported: true,
        description: 'Backed by SQL OFFSET/LIMIT and page-based windowing.',
        styles: { offset: true, page: true, cursor: false },
      },
      changes: unsupportedChanges,
    });
  }
}
