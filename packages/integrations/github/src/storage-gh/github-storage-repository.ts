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
import {
  applyPagination,
  type Atom,
  type AtomSummary,
  Capabilities,
  CompatibilityDate,
  defaultDetermineExtension,
  type DetermineExtension,
  type Folder,
  type FolderCreate,
  type ListAtomsDone,
  type ListAtomsOptions,
  pathCombine,
  type RemoveAtomsDone,
  type StorageObject,
  type StorageObjectContent,
  type StorageObjectCreate,
  type StorageObjectUpdate,
  StorageRepository,
  type StorageSerializerRegistry,
} from 'laikacms/storage';
import * as minimatch from 'minimatch';

import { GithubDataSource, type GithubDataSourceOptions } from './github-datasource.js';

export interface GithubStorageRepositoryOptions extends GithubDataSourceOptions {
  serializerRegistry: StorageSerializerRegistry;
  defaultFileExtension: string;
  ignoreList?: string[];
  commitAuthor?: { name: string, email: string };
  determineExtension?: DetermineExtension;
}

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.contentbase',
  '**/.laikacms',
];

const liftResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

/**
 * StorageRepository backed by a GitHub repository.
 */
export class GithubStorageRepository extends StorageRepository {
  private readonly dataSource: GithubDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly commitAuthor?: { name: string, email: string };
  private readonly determineExtension: DetermineExtension;

  constructor(options: GithubStorageRepositoryOptions) {
    super();
    const {
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      commitAuthor,
      determineExtension = defaultDetermineExtension,
      ...dataSourceOptions
    } = options;

    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultFileExtension;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.commitAuthor = commitAuthor;
    this.determineExtension = determineExtension;
    this.dataSource = new GithubDataSource(dataSourceOptions);
    this.excludeFilter = ignoreList
      .map(p => minimatch.makeRe(p, { dot: true, partial: true }))
      .filter((x): x is minimatch.MMRegExp => x !== false);
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

  private stripExtension(p: string): string {
    for (const ext of this.availableExtensions) {
      if (p.endsWith(`.${ext}`)) return p.slice(0, -(ext.length + 1));
    }
    return p;
  }

  private async resolvePathWithExtension(
    key: string,
  ): Promise<{ path: string, extension: string } | null> {
    const base = this.stripExtension(key);
    for (const ext of this.availableExtensions) {
      const candidate = `${base}.${ext}`;
      const meta = await this.dataSource.getFileMeta(candidate);
      if (Result.isSuccess(meta)) return { path: candidate, extension: ext };
    }
    return null;
  }

  private async serialize(ext: string, content: StorageObjectContent): Promise<string> {
    const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
    const serializer = this.serializerRegistry[cleanExt];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${cleanExt}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
      );
    }
    return serializer.serializeDocumentFileContents(content, {});
  }

  private async deserialize(ext: string, content: string): Promise<StorageObjectContent> {
    const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
    const serializer = this.serializerRegistry[cleanExt];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${cleanExt}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
      );
    }
    return serializer.deserializeDocumentFileContents(content, {});
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolvePathWithExtension(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`The file at ${key} does not exist`));
        }
        const [content, meta] = yield* Effect.all(
          [
            liftResult(this.dataSource.getFileContents(resolved.path)),
            liftResult(this.dataSource.getFileMeta(resolved.path)),
          ],
          { concurrency: 2 },
        );
        const deserialized = yield* Effect.promise(() => this.deserialize(resolved.extension, content.content));
        return {
          type: 'object',
          key: this.stripExtension(resolved.path),
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
          content: deserialized,
          metadata: { extension: resolved.extension, revisionId: meta.sha },
        } satisfies StorageObject;
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required for creation'));
        }
        const existing = yield* Effect.promise(() => this.resolvePathWithExtension(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const ext = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(ext, create.content!));
        const path = `${this.stripExtension(create.key)}.${ext}`;
        yield* liftResult(
          this.dataSource.createOrUpdate(path, serialized, {
            commitMessage: `Create ${path}`,
            author: this.commitAuthor,
          }),
        );
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolvePathWithExtension(update.key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`The file at ${update.key} does not exist`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(resolved.extension, update.content!));
          yield* liftResult(
            this.dataSource.createOrUpdate(resolved.path, serialized, {
              commitMessage: `Update ${resolved.path}`,
              author: this.commitAuthor,
            }),
          );
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        // When metadata pins an extension, that's authoritative — don't let a stale
        // file at a different extension capture the write.
        const requested = create.metadata?.extension;
        const metadataExt = requested && this.serializerRegistry[requested] ? requested : undefined;
        const existing = metadataExt
          ? null
          : yield* Effect.promise(() => this.resolvePathWithExtension(create.key));
        const ext = metadataExt ?? existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const path = existing?.path ?? `${this.stripExtension(create.key)}.${ext}`;
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(ext, create.content!))
          : '';
        yield* liftResult(
          this.dataSource.createOrUpdate(path, serialized, {
            commitMessage: `${existing ? 'Update' : 'Create'} ${path}`,
            author: this.commitAuthor,
          }),
        );
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.dataSource.listDirectory(key));
        const now = new Date(0).toISOString();
        return { type: 'folder', key, createdAt: now, updatedAt: now } satisfies Folder;
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const keepPath = pathCombine(folderCreate.key, '.keep');
        yield* liftResult(
          this.dataSource.createOrUpdate(keepPath, '', {
            commitMessage: `Create directory ${folderCreate.key}`,
            author: this.commitAuthor,
          }),
        );
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const typeResult = yield* Effect.result(
          Effect.tryPromise({
            try: () => this.dataSource.pathType(key),
            catch: e =>
              e instanceof NotFoundError
                ? e
                : e instanceof Error
                ? new BadRequestError(e.message)
                : new BadRequestError(String(e)),
          }),
        );
        // pathType failures (incl. NotFound) → probe as file with an extension via getObject.
        if (typeResult._tag === 'Failure') {
          return yield* LaikaTask.runValue(this.getObject(key));
        }
        if (typeResult.success === 'file') {
          return yield* LaikaTask.runValue(this.getObject(key));
        }
        return yield* LaikaTask.runValue(this.getFolder(key));
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
      const listing = yield* liftResult(this.dataSource.listDirectory(folderKey));
      const filtered = listing.filter(
        entry => this.excludeFilter.every(re => !re.test(entry.path)),
      );
      const summaries: AtomSummary[] = filtered.map(entry => {
        let key = entry.path;
        if (entry.type === 'file') {
          for (const ext of this.availableExtensions) {
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
      return applyPagination(summaries, options.pagination);
    });
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const resolved = yield* Effect.promise(() => this.resolvePathWithExtension(key));
          if (!resolved) {
            yield* emit.recoverableError(new NotFoundError(`The file at ${key} does not exist`));
            skipped += 1;
            continue;
          }
          const metaResult = yield* Effect.result(liftResult(this.dataSource.getFileMeta(resolved.path)));
          if (Result.isFailure(metaResult)) {
            yield* emit.recoverableError(metaResult.failure);
            skipped += 1;
            continue;
          }
          const deleteResult = yield* Effect.result(
            liftResult(
              this.dataSource.deleteFile(resolved.path, metaResult.success.sha, {
                commitMessage: `Delete ${resolved.path}`,
                author: this.commitAuthor,
              }),
            ),
          );
          if (Result.isFailure(deleteResult)) {
            yield* emit.recoverableError(deleteResult.failure);
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

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      fileExtensions: {
        supported: true,
        description: 'Supported file types depend on the serializers provided to this repository.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over the GitHub tree listing; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
      compatibilityDate: CompatibilityDate.make('2024-06-01'),
    });
  }
}
