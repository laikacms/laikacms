import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  InvalidData,
  type LaikaError,
  type LaikaResult,
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
  StorageSerializerRegistry,
} from 'laikacms/storage';
import {
  applyPagination,
  type Capabilities,
  CompatibilityDate,
  defaultDetermineExtension,
  type DetermineExtension,
  naturalCompare,
  StorageRepository,
} from 'laikacms/storage';

import { DdbStorageDataSource, splitKey, type StorageItem } from './ddb-datasource.js';

export interface DdbStorageRepositoryOptions {
  /** Pre-built DocumentClient. The repository never owns AWS credentials. */
  readonly docClient: DynamoDBDocumentClient;
  /** Name of the DynamoDB table backing the storage. */
  readonly tableName: string;
  /** Optional partition-key prefix; defaults to `STORAGE#`. Set this for multi-tenant deployments. */
  readonly partitionPrefix?: string;
  /** Override the partition-key attribute name. Defaults to `PK`. */
  readonly pkAttribute?: string;
  /** Override the sort-key attribute name. Defaults to `SK`. */
  readonly skAttribute?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

/**
 * A {@link StorageRepository} backed by a single DynamoDB table.
 *
 * Schema (defaults — every attribute name is overridable):
 *
 *     PK = "STORAGE#<parentKey>"   — partition per folder
 *     SK = "<basename>"            — file name with extension, or folder name
 *     Type      = "file" | "folder"
 *     Content   = string           (files only)
 *     Extension = string           (files only)
 *     CreatedAt = ISO timestamp
 *     UpdatedAt = ISO timestamp
 *     ETag      = opaque per-write tag (used as `metadata.revisionId`)
 *
 * Listing a folder is a single `Query` against the partition. Finding an
 * extension-free key uses one `Query` with `begins_with(SK, "<base>.")` then
 * a client-side filter to the registered serializer extensions — so a read
 * is O(1) RCU regardless of bucket size.
 *
 * The repository auto-creates folder markers when writing a deeply nested
 * key, mirroring the implicit-folder semantics of `storage-r2` / `storage-s3`
 * while keeping the listing model exact (a query against a missing partition
 * is indistinguishable from an empty folder, so we record markers explicitly).
 */
export class DdbStorageRepository extends StorageRepository {
  private readonly dataSource: DdbStorageDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: DdbStorageRepositoryOptions) {
    super();
    this.serializerRegistry = options.serializerRegistry;
    this.defaultFileExtension = options.defaultFileExtension.startsWith('.')
      ? options.defaultFileExtension.slice(1)
      : options.defaultFileExtension;
    this.availableExtensions = Object.keys(options.serializerRegistry);
    this.determineExtension = options.determineExtension ?? defaultDetermineExtension;
    this.dataSource = new DdbStorageDataSource({
      docClient: options.docClient,
      tableName: options.tableName,
      partitionPrefix: options.partitionPrefix,
      pkAttribute: options.pkAttribute,
      skAttribute: options.skAttribute,
      availableExtensions: this.availableExtensions,
    });
  }

  private resolveExtension(key: string, metadata: StorageObject['metadata'] | undefined): string {
    const requested = this.determineExtension(key, {
      metadata,
      defaultExtension: this.defaultFileExtension,
    });
    if (requested && this.serializerRegistry[requested]) return requested;
    return this.defaultFileExtension;
  }

  private async serialize(extension: string, content: StorageObjectContent): Promise<string> {
    const ext = extension.startsWith('.') ? extension.slice(1) : extension;
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${this.availableExtensions.join(', ')}`,
      );
    }
    return serializer.serializeDocumentFileContents(content, {});
  }

  private async deserialize(extension: string, raw: string): Promise<StorageObjectContent> {
    const ext = extension.startsWith('.') ? extension.slice(1) : extension;
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${this.availableExtensions.join(', ')}`,
      );
    }
    return serializer.deserializeDocumentFileContents(raw, {});
  }

  private stripExtension(name: string): string {
    for (const ext of this.availableExtensions) {
      if (name.endsWith(`.${ext}`)) return name.slice(0, -(ext.length + 1));
    }
    return name;
  }

  /** Materialise an `Atom`/`AtomSummary` key from a row that lives at (parent, name). */
  private keyFor(item: StorageItem): string {
    const name = item.type === 'file' ? this.stripExtension(item.name) : item.name;
    return item.parentKey === '' ? name : `${item.parentKey}/${name}`;
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const { parent, name } = splitKey(key);
        const found = yield* liftResult(this.dataSource.findFile(parent, name));
        if (!found || !found.item.content) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const content = yield* Effect.promise(() => this.deserialize(found.extension, found.item.content!));
        return {
          type: 'object',
          key,
          createdAt: found.item.createdAt,
          updatedAt: found.item.updatedAt,
          content,
          metadata: { extension: found.extension, revisionId: found.item.etag },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const { parent, name } = splitKey(key);
        if (name === '') {
          // Root folder — synthesise minimal metadata.
          const now = new Date(0).toISOString();
          return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
        }
        const item = yield* liftResult(this.dataSource.getItem(parent, name));
        if (!item || item.type !== 'folder') {
          return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        }
        return {
          type: 'folder',
          key,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const { parent, name } = splitKey(key);
        const direct = yield* liftResult(this.dataSource.getItem(parent, name));
        if (direct?.type === 'folder') {
          return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
        }
        return yield* LaikaTask.runValue(this.getObject(key)) as Effect.Effect<Atom, LaikaError>;
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required for creation'));
        }
        const { parent, name } = splitKey(create.key);
        const existing = yield* liftResult(this.dataSource.findFile(parent, name));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        yield* liftResult(this.dataSource.putFile(parent, `${name}.${extension}`, serialized, extension));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const { parent, name } = splitKey(update.key);
        const existing = yield* liftResult(this.dataSource.findFile(parent, name));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() =>
            this.serialize(existing.extension, update.content!)
          );
          yield* liftResult(this.dataSource.putFile(parent, existing.item.name, serialized, existing.extension));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const { parent, name } = splitKey(create.key);
        const existing = yield* liftResult(this.dataSource.findFile(parent, name));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        yield* liftResult(this.dataSource.putFile(parent, `${name}.${extension}`, serialized, extension));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.dataSource.ensureFolderChain(folderCreate.key));
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const { parent, name } = splitKey(key);
          const direct = yield* Effect.result(liftResult(this.dataSource.getItem(parent, name)));
          if (Result.isFailure(direct)) {
            yield* emit.recoverableError(direct.failure);
            skipped += 1;
            continue;
          }

          if (direct.success?.type === 'folder') {
            // Refuse to delete a non-empty folder.
            const children = yield* Effect.result(liftResult(this.dataSource.listChildren(key)));
            if (Result.isFailure(children)) {
              yield* emit.recoverableError(children.failure);
              skipped += 1;
              continue;
            }
            if (children.success.length > 0) {
              yield* emit.recoverableError(new NotFoundError(`Refusing to delete non-empty folder "${key}"`));
              skipped += 1;
              continue;
            }
            const deleted = yield* Effect.result(liftResult(this.dataSource.deleteItem(parent, name)));
            if (Result.isFailure(deleted)) {
              yield* emit.recoverableError(deleted.failure);
              skipped += 1;
            } else {
              yield* emit.data(key);
              removed += 1;
            }
            continue;
          }

          // Fall through: resolve the on-table file (key + extension).
          const file = yield* Effect.result(liftResult(this.dataSource.findFile(parent, name)));
          if (Result.isFailure(file)) {
            yield* emit.recoverableError(file.failure);
            skipped += 1;
            continue;
          }
          if (!file.success) {
            yield* emit.recoverableError(new NotFoundError(`No atom found at key "${key}"`));
            skipped += 1;
            continue;
          }
          const deleted = yield* Effect.result(
            liftResult(this.dataSource.deleteItem(parent, file.success.item.name)),
          );
          if (Result.isFailure(deleted)) {
            yield* emit.recoverableError(deleted.failure);
            skipped += 1;
          } else {
            yield* emit.data(key);
            removed += 1;
          }
        }
        return { removed, skipped };
      })
    );
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    return LaikaStream.make<AtomSummary, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const { summaries, missingFolder } = yield* this.collectSummaries(folderKey, options);
        if (missingFolder) yield* emit.recoverableError(missingFolder);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total: summaries.length };
      })
    );
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const { summaries, missingFolder } = yield* this.collectSummaries(folderKey, options);
        if (missingFolder) yield* emit.recoverableError(missingFolder);
        for (const summary of summaries) {
          if (summary.type === 'object-summary') {
            const result = yield* Effect.result(LaikaTask.runValue(this.getObject(summary.key)));
            if (Result.isFailure(result)) yield* emit.recoverableError(result.failure);
            else yield* emit.data(result.success);
          } else {
            const result = yield* Effect.result(LaikaTask.runValue(this.getFolder(summary.key)));
            if (Result.isFailure(result)) yield* emit.recoverableError(result.failure);
            else yield* emit.data(result.success);
          }
        }
        return { total: summaries.length };
      })
    );
  }

  private collectSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<
    { summaries: ReadonlyArray<AtomSummary>; missingFolder?: LaikaError },
    LaikaError
  > {
    return Effect.gen({ self: this }, function*() {
      const exists = yield* liftResult(this.dataSource.folderExists(folderKey));
      const listing = yield* Effect.result(liftResult(this.dataSource.listChildren(folderKey)));
      if (Result.isFailure(listing)) return yield* Effect.fail(listing.failure);

      // A folder that doesn't exist AND has no children → recoverable NotFound,
      // matching the contract every other StorageRepository honors.
      if (!exists && listing.success.length === 0) {
        return {
          summaries: [] as ReadonlyArray<AtomSummary>,
          missingFolder: new NotFoundError(`No folder found at key "${folderKey || '<root>'}"`),
        };
      }

      const summaries: AtomSummary[] = listing.success.map(item => {
        const key = this.keyFor(item);
        return { type: item.type === 'file' ? 'object-summary' : 'folder-summary', key };
      });
      const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(sorted, options.pagination) };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-19'),
      fileExtensions: {
        supported: true,
        description: 'Stores each object as a row in DynamoDB using any registered serializer extension.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over a `Query` against the parent partition; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
