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

import { R2DataSource } from '../datasources/r2-datasource.js';

const liftResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

/**
 * R2StorageRepository implements the StorageRepository interface using Cloudflare R2.
 * R2 is a flat object store, so this implementation simulates a hierarchical file system:
 * - Folders are represented by key prefixes
 * - Empty folders are represented by .keep files
 * - File extensions are handled transparently
 */
export class R2StorageRepository extends StorageRepository {
  private excludeFilter: minimatch.MMRegExp[];
  private r2DataSource: R2DataSource;

  constructor(
    bucket: R2Bucket,
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
    private readonly determineExtension: DetermineExtension = defaultDetermineExtension,
  ) {
    super();
    const availableExtensions = Object.keys(this.serializerRegistry);
    this.r2DataSource = new R2DataSource(bucket, availableExtensions, defaultFileExtension);
    this.excludeFilter = this.ignoreList
      .map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true }))
      .filter(x => x !== false);
  }

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
        const meta = yield* liftResult(this.r2DataSource.getFolderMeta(key));
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
        const isFile = yield* Effect.promise(() => this.r2DataSource.isFile(key));
        if (isFile) return yield* LaikaTask.runValue(this.getObject(key));
        const isDir = yield* Effect.promise(() => this.r2DataSource.isDirectory(key));
        if (isDir) return yield* LaikaTask.runValue(this.getFolder(key));
        return yield* Effect.fail(new BadRequestError(`Path not found: ${key}`));
      })
    );
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const [meta, contents] = yield* Effect.all(
          [
            liftResult(this.r2DataSource.getObjectMeta(key)),
            liftResult(this.r2DataSource.getObjectContents(key)),
          ],
          { concurrency: 2 },
        );
        const ext = contents.extension;
        const content = yield* Effect.promise(() => this.deserialize(ext, contents.content));
        return {
          type: 'object',
          key: contents.key,
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
        const meta = yield* liftResult(this.r2DataSource.getObjectMeta(update.key));
        const ext = meta.extension;
        if (update.content) {
          const stringified = yield* Effect.promise(() => this.serialize(ext, update.content!));
          yield* liftResult(this.r2DataSource.createOrUpdate(update.key, stringified, ext));
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
        const existingExt = yield* Effect.promise(() => this.r2DataSource.findExistingObjectExtension(create.key));
        if (existingExt) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existingExt}`,
            ),
          );
        }
        const ext = this.resolveExtension(create.key, create.metadata);
        const stringified = yield* Effect.promise(() => this.serialize(ext, create.content!));
        yield* liftResult(this.r2DataSource.createOrUpdate(create.key, stringified, ext));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existingExt = yield* Effect.promise(() => this.r2DataSource.findExistingObjectExtension(create.key));
        const ext = existingExt ?? this.resolveExtension(create.key, create.metadata);
        const stringified = create.content
          ? yield* Effect.promise(() => this.serialize(ext, create.content!))
          : '';
        yield* liftResult(this.r2DataSource.createOrUpdate(create.key, stringified, ext));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  private resolveExtension(
    key: string,
    metadata: StorageObject['metadata'] | undefined,
  ): string {
    const requested = this.determineExtension(key, {
      metadata,
      defaultExtension: this.defaultFileExtension,
    });
    if (requested && this.serializerRegistry[requested]) return requested;
    return this.defaultFileExtension;
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(
          this.r2DataSource.createOrUpdate(pathCombine(folderCreate.key, '.keep'), '', ''),
        );
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const results = yield* Effect.promise(async () => {
          const out: LaikaResult<string>[] = [];
          for await (const r of this.r2DataSource.deleteObjects(keys)) out.push(r);
          return out;
        });

        let removed = 0;
        let skipped = 0;
        for (const r of results) {
          if (Result.isFailure(r)) {
            yield* emit.recoverableError(r.failure);
            skipped += 1;
            continue;
          }
          yield* emit.data(r.success);
          removed += 1;
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
        const summaries = yield* this.collectFilteredSummaries(folderKey, options);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total: summaries.length };
      })
    );
  }

  listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const summaries = yield* this.collectFilteredSummaries(folderKey, options);
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

  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const entries = yield* liftResult(this.r2DataSource.listDirectory(folderKey));
      const availableExtensions = Object.keys(this.serializerRegistry);
      const filtered = entries
        .filter((entry: { key: string, type: string }) => this.excludeFilter.every(pattern => !pattern.test(entry.key)))
        .map((entry: { key: string, type: string }): AtomSummary => {
          let key = entry.key;
          if (entry.type === 'file') {
            for (const ext of availableExtensions) {
              if (key.endsWith(`.${ext}`)) {
                key = key.slice(0, -(ext.length + 1));
                break;
              }
            }
          }
          return {
            type: entry.type === 'file' ? 'object-summary' : 'folder-summary',
            key,
          };
        });
      const sorted = [...filtered].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2024-06-01'),
      fileExtensions: {
        supported: true,
        supportedExtensions: this.serializerRegistry,
        description: 'Supported file types depend on the serializers provided to this repository.',
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over object listings; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
