import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  ForbiddenError,
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
  StorageSerializerRegistry,
} from 'laikacms/storage';
import {
  applyPagination,
  type Capabilities,
  CompatibilityDate,
  defaultDetermineExtension,
  type DetermineExtension,
  naturalCompare,
  pathToSegments,
  StorageRepository,
} from 'laikacms/storage';

import { WebDavConfig, WebDavDataSource } from '../datasources/webdav-datasource.js';

/** Lift a `Promise<LaikaResult<A>>` into `Effect<A, LaikaError>`. */
const liftResult = <A>(promise: Promise<Result.Result<A, LaikaError>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

/** ISO timestamp from an optional `Date`, or `undefined` when the server gave none. */
const isoOrUndefined = (date: Date | undefined): string | undefined => date?.toISOString();

/**
 * A {@link StorageRepository} backed by any RFC 4918 WebDAV server — Nextcloud,
 * ownCloud, Apache `mod_dav`, `rclone serve webdav`, and friends.
 *
 * WebDAV maps almost one-to-one onto the storage contract: collections are
 * folders, resources are objects, and `PROPFIND`/`GET`/`PUT`/`DELETE`/`MKCOL`
 * cover every operation. As with the filesystem repository, keys are
 * extension-free: the on-server file extension is chosen from the serializer
 * registry and hidden from callers.
 *
 * The implementation is runtime-agnostic — it only needs a `fetch`.
 */
export class WebDavStorageRepository extends StorageRepository {
  private readonly dataSource: WebDavDataSource;
  private readonly availableExtensions: readonly string[];

  constructor(
    config: WebDavConfig,
    private readonly serializerRegistry: StorageSerializerRegistry,
    private readonly defaultFileExtension: string,
    /** Optional policy for picking the on-server extension of a new object. */
    private readonly determineExtension: DetermineExtension = defaultDetermineExtension,
  ) {
    super();
    if (defaultFileExtension.startsWith('.')) {
      this.defaultFileExtension = defaultFileExtension.slice(1);
    }
    this.availableExtensions = Object.keys(this.serializerRegistry);
    this.dataSource = new WebDavDataSource(config, this.availableExtensions);
  }

  private async serialize(extension: string, content: StorageObjectContent): Promise<string> {
    const serializer = this.serializerRegistry[extension];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${extension}. `
          + `Available formats: ${this.availableExtensions.join(', ')}`,
      );
    }
    try {
      return await serializer.serializeDocumentFileContents(content, {});
    } catch (error) {
      throw new BadRequestError(
        `Failed to serialize content: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async deserialize(extension: string, raw: string): Promise<StorageObjectContent> {
    const serializer = this.serializerRegistry[extension];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${extension}. `
          + `Available formats: ${this.availableExtensions.join(', ')}`,
      );
    }
    try {
      return await serializer.deserializeDocumentFileContents(raw, {});
    } catch (error) {
      throw new BadRequestError(
        `Failed to deserialize content: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private resolveExtension(key: string, metadata: StorageObject['metadata'] | undefined): string {
    const requested = this.determineExtension(key, {
      metadata,
      defaultExtension: this.defaultFileExtension,
    });
    if (requested && this.serializerRegistry[requested]) return requested;
    return this.defaultFileExtension;
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* liftResult(this.dataSource.resolveExisting(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const raw = yield* liftResult(this.dataSource.readFile(key, resolved.extension));
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, raw));
        return {
          type: 'object',
          key,
          createdAt: isoOrUndefined(resolved.resource.creationDate),
          updatedAt: isoOrUndefined(resolved.resource.lastModified),
          content,
          metadata: { extension: resolved.extension },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const resource = yield* liftResult(this.dataSource.statResource(key));
        if (!resource || !resource.isCollection) {
          return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        }
        return {
          type: 'folder',
          key,
          createdAt: isoOrUndefined(resource.creationDate),
          updatedAt: isoOrUndefined(resource.lastModified),
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const resource = yield* liftResult(this.dataSource.statResource(key));
        if (resource?.isCollection) {
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
        const existing = yield* liftResult(this.dataSource.resolveExisting(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        yield* liftResult(this.dataSource.writeFile(create.key, extension, serialized));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.dataSource.resolveExisting(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        yield* liftResult(this.dataSource.writeFile(create.key, extension, serialized));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.dataSource.resolveExisting(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension, update.content!));
          yield* liftResult(this.dataSource.writeFile(update.key, existing.extension, serialized));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.dataSource.ensureCollection(folderCreate.key));
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
          const statResult = yield* Effect.result(liftResult(this.dataSource.statResource(key)));
          if (Result.isFailure(statResult)) {
            yield* emit.recoverableError(statResult.failure);
            skipped += 1;
            continue;
          }

          // A collection at `key`: refuse to delete it while it still has children.
          if (statResult.success?.isCollection) {
            const children = yield* Effect.result(liftResult(this.dataSource.listChildren(key)));
            if (Result.isFailure(children)) {
              yield* emit.recoverableError(children.failure);
              skipped += 1;
              continue;
            }
            if (children.success.length > 0) {
              yield* emit.recoverableError(
                new ForbiddenError(`Refusing to delete non-empty folder "${key}"`),
              );
              skipped += 1;
              continue;
            }
            const deleted = yield* Effect.result(liftResult(this.dataSource.deleteResource(key)));
            if (Result.isFailure(deleted)) {
              yield* emit.recoverableError(deleted.failure);
              skipped += 1;
            } else {
              yield* emit.data(key);
              removed += 1;
            }
            continue;
          }

          // Otherwise resolve the object's on-server file (key + extension).
          const resolved = yield* Effect.result(liftResult(this.dataSource.resolveExisting(key)));
          if (Result.isFailure(resolved)) {
            yield* emit.recoverableError(resolved.failure);
            skipped += 1;
            continue;
          }
          if (!resolved.success) {
            yield* emit.recoverableError(new NotFoundError(`No atom found at key "${key}"`));
            skipped += 1;
            continue;
          }
          const target = `${key}.${resolved.success.extension}`;
          const deleted = yield* Effect.result(liftResult(this.dataSource.deleteResource(target)));
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

  /**
   * Shared listing core: `PROPFIND Depth: 1`, strip file extensions, sort
   * naturally, paginate in memory. A missing collection is reported via
   * `missingFolder` (a recoverable {@link NotFoundError}) rather than failing
   * the stream.
   */
  private collectSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<
    { summaries: ReadonlyArray<AtomSummary>, missingFolder?: LaikaError },
    LaikaError
  > {
    return Effect.gen({ self: this }, function*() {
      const listing = yield* Effect.result(liftResult(this.dataSource.listChildren(folderKey)));
      if (Result.isFailure(listing)) {
        if (listing.failure instanceof NotFoundError) {
          return { summaries: [] as ReadonlyArray<AtomSummary>, missingFolder: listing.failure };
        }
        return yield* Effect.fail(listing.failure);
      }

      const summaries = listing.success.map((child): AtomSummary => {
        if (child.isCollection) {
          return { type: 'folder-summary', key: child.key };
        }
        let key = child.key;
        for (const extension of this.availableExtensions) {
          if (key.endsWith(`.${extension}`)) {
            key = key.slice(0, -(extension.length + 1));
            break;
          }
        }
        return { type: 'object-summary', key };
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
        description: 'Stores objects as files on the WebDAV server using any registered serializer extension',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over a PROPFIND Depth:1 listing; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}

/** A path segment count helper kept for parity with the filesystem repository. */
export const webDavKeyDepth = (key: string): number => pathToSegments(key).length;
