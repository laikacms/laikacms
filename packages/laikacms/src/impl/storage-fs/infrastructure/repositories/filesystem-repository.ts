import * as fs from 'fs/promises';
import * as path from 'path';

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
  Capabilities,
  CompatibilityDate,
  defaultDetermineExtension,
  type DetermineExtension,
  naturalCompare,
  pathCombine,
  StorageRepository,
} from 'laikacms/storage';
import * as minimatch from 'minimatch';

import { FileSystemDataSource } from '../datasources/filesystem-datasource.js';

/**
 * Lift `Promise<LaikaResult<A>>` into `Effect<A, LaikaError>` — the typical
 * datasource call shape in this implementation.
 */
const liftResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

export class FileSystemStorageRepository extends StorageRepository {
  private excludeFilter: minimatch.MMRegExp[];
  private fileSystemDataSource: FileSystemDataSource;

  constructor(
    private readonly rootDirectory: string,
    private readonly serializerRegistry: StorageSerializerRegistry,
    private readonly defaultFileExtension: string,
    private readonly ignoreList: string[] = [
      '**/.keep',
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/desktop.ini',
      '**/.contentbase',
      '**/.laikacms',
    ],
    /**
     * Optional callback that picks the file extension for a new object.
     */
    private readonly determineExtension: DetermineExtension = defaultDetermineExtension,
  ) {
    super();
    if (defaultFileExtension.startsWith('.')) {
      this.defaultFileExtension = defaultFileExtension.slice(1);
    }
    const availableExtensions = Object.keys(this.serializerRegistry);
    this.fileSystemDataSource = new FileSystemDataSource(availableExtensions, defaultFileExtension);
    this.excludeFilter = this.ignoreList
      .map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true }))
      .filter(x => x !== false);
  }

  /** Serialize StorageObjectContent to a string for storage on disk. */
  private async serialize(ext: string, content: StorageObjectContent): Promise<string> {
    if (ext.startsWith('.')) ext = ext.slice(1);
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
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

  /** Deserialize raw file contents back into StorageObjectContent. */
  private async deserialize(ext: string, content: string): Promise<StorageObjectContent> {
    if (ext.startsWith('.')) ext = ext.slice(1);
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
      );
    }
    try {
      return await serializer.deserializeDocumentFileContents(content, {});
    } catch (error) {
      throw new BadRequestError(
        `Failed to deserialize content: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(
          this.fileSystemDataSource.getDirMeta(this.rootDirectory, key),
        );
        return {
          type: 'folder',
          key,
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const isDir = yield* Effect.promise(() =>
          this.fileSystemDataSource.isDir(this.rootDirectory, key).catch(() => false)
        );
        if (isDir) {
          return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
        }
        return yield* LaikaTask.runValue(this.getObject(key)) as Effect.Effect<Atom, LaikaError>;
      })
    );
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const [meta, contents] = yield* Effect.all(
          [
            liftResult(this.fileSystemDataSource.getFileMeta(this.rootDirectory, key)),
            liftResult(this.fileSystemDataSource.getFileContents(this.rootDirectory, key)),
          ],
          { concurrency: 2 },
        );

        const ext = contents.extension;
        const content = yield* Effect.promise(() => this.deserialize(ext, contents.content));

        return {
          type: 'object',
          key: contents.path,
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
          content,
          metadata: { extension: ext },
        } satisfies StorageObject;
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(
          this.fileSystemDataSource.getFileMeta(this.rootDirectory, update.key),
        );
        const ext = meta.extension;

        if (update.content) {
          const stringified = yield* Effect.promise(() => this.serialize(ext, update.content!));
          yield* liftResult(
            this.fileSystemDataSource.createOrUpdate(this.rootDirectory, update.key, stringified, ext),
          );
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required for creation'));
        }
        const existingExt = yield* Effect.promise(() =>
          this.fileSystemDataSource.findExistingFileExtension(this.rootDirectory, create.key)
        );
        if (existingExt) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existingExt}`,
            ),
          );
        }
        const ext = this.resolveExtension(create.key, create.metadata);
        const stringified = yield* Effect.promise(() => this.serialize(ext, create.content!));
        yield* liftResult(
          this.fileSystemDataSource.createOrUpdate(this.rootDirectory, create.key, stringified, ext),
        );
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existingExt = yield* Effect.promise(() =>
          this.fileSystemDataSource.findExistingFileExtension(this.rootDirectory, create.key)
        );
        const ext = existingExt ?? this.resolveExtension(create.key, create.metadata);
        const stringified = create.content
          ? yield* Effect.promise(() => this.serialize(ext, create.content!))
          : '';
        yield* liftResult(
          this.fileSystemDataSource.createOrUpdate(this.rootDirectory, create.key, stringified, ext),
        );
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(
          this.fileSystemDataSource.createOrUpdate(
            this.rootDirectory,
            pathCombine(folderCreate.key, '.keep'),
            '',
            'keep',
          ),
        );
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const batches = yield* Effect.promise(async () => {
          // Resolve each key to its actual on-disk path (with extension)
          const availableExtensions = Object.keys(this.serializerRegistry);
          const resolvedEntries: Array<{ path: string, type: 'file' | 'dir' }> = [];
          for (const key of keys) {
            try {
              const stat = await fs.stat(path.join(this.rootDirectory, key));
              if (stat.isDirectory()) {
                resolvedEntries.push({ path: key, type: 'dir' });
                continue;
              }
              resolvedEntries.push({ path: key, type: 'file' });
            } catch {
              // Not a raw path — try with each known extension
              const keyWithoutExt = key.includes('.')
                ? key.slice(0, key.lastIndexOf('.'))
                : key;
              let found = false;
              for (const ext of availableExtensions) {
                const candidate = `${keyWithoutExt}.${ext}`;
                try {
                  await fs.access(path.join(this.rootDirectory, candidate));
                  resolvedEntries.push({ path: candidate, type: 'file' });
                  found = true;
                  break;
                } catch { /* try next */ }
              }
              if (!found) {
                // Not found — pass as-is so deleteEntries reports it as skipped
                resolvedEntries.push({ path: key, type: 'file' });
              }
            }
          }

          const out: LaikaResult<{ path: string }[]>[] = [];
          for await (
            const batch of this.fileSystemDataSource.deleteEntries(
              this.rootDirectory,
              resolvedEntries,
            )
          ) out.push(batch);
          return out;
        });

        let removed = 0;
        let skipped = 0;
        for (const batch of batches) {
          if (Result.isFailure(batch)) {
            yield* emit.recoverableError(batch.failure);
            skipped += 1;
            continue;
          }
          for (const dirSub of batch.success) {
            yield* emit.data(dirSub.path);
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
        const { summaries, missingFolder } = yield* this.collectFilteredSummaries(folderKey, options);
        if (missingFolder) yield* emit.recoverableError(missingFolder);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total: summaries.length };
      })
    );
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const { summaries, missingFolder } = yield* this.collectFilteredSummaries(folderKey, options);
        if (missingFolder) yield* emit.recoverableError(missingFolder);
        for (const summary of summaries) {
          if (summary.type === 'object-summary') {
            const r = yield* Effect.result(LaikaTask.runValue(this.getObject(summary.key)));
            if (Result.isFailure(r)) yield* emit.recoverableError(r.failure);
            else yield* emit.data(r.success);
          } else {
            const r = yield* Effect.result(LaikaTask.runValue(this.getFolder(summary.key)));
            if (Result.isFailure(r)) yield* emit.recoverableError(r.failure);
            else yield* emit.data(r.success);
          }
        }
        return { total: summaries.length };
      })
    );
  }

  /**
   * Shared filtering + pagination for listAtoms / listAtomSummaries.
   *
   * A missing folder is not a fatal error for a listing: it surfaces as
   * `missingFolder` (a recoverable {@link NotFoundError}) with an empty
   * `summaries` array, so callers can emit a warning rather than crashing the
   * stream.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<{ summaries: ReadonlyArray<AtomSummary>, missingFolder?: LaikaError }, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const dirResult = yield* Effect.promise(() =>
        this.fileSystemDataSource.listFileSystemDirectory(this.rootDirectory, folderKey)
      );
      if (Result.isFailure(dirResult)) {
        if (dirResult.failure instanceof NotFoundError) {
          return { summaries: [] as ReadonlyArray<AtomSummary>, missingFolder: dirResult.failure };
        }
        return yield* Effect.fail(dirResult.failure);
      }
      const dirSubs = dirResult.success;
      const availableExtensions = Object.keys(this.serializerRegistry);
      const filtered = dirSubs
        .filter((dirSub: { path: string, type: string }) =>
          this.excludeFilter.every(pattern => !pattern.test(dirSub.path))
        )
        .map((dirSub: { path: string, type: string }): AtomSummary => {
          let key = dirSub.path;
          if (dirSub.type === 'file') {
            for (const ext of availableExtensions) {
              if (key.endsWith(`.${ext}`)) {
                key = key.slice(0, -(ext.length + 1));
                break;
              }
            }
          }
          return {
            type: dirSub.type === 'file' ? 'object-summary' : 'folder-summary',
            key,
          };
        });
      const sorted = [...filtered].sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(sorted, options.pagination) };
    });
  }

  private resolveExtension(
    key: string,
    metadata: StorageObject['metadata'] | undefined,
  ): string {
    const requested = this.determineExtension(key, {
      metadata,
      defaultExtension: this.defaultFileExtension,
    });
    if (requested && this.serializerRegistry[requested]) {
      return requested;
    }
    return this.defaultFileExtension;
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-11'),
      fileExtensions: {
        supported: true,
        description: 'Supports any file extension that is supported by this filesystem',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over directory listings; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
