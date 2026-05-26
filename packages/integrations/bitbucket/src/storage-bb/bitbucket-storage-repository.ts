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
  type Capabilities,
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

import { BitbucketDataSource, type BitbucketDataSourceOptions } from './bitbucket-datasource.js';

export interface BitbucketStorageRepositoryOptions extends BitbucketDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly commitAuthor?: { readonly name: string, readonly email: string };
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.contentbase',
  '**/.laikacms',
];

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

/**
 * A {@link StorageRepository} backed by a Bitbucket Cloud repository.
 * Closes the git-platform triumvirate alongside `@laikacms/github` and
 * `@laikacms/gitlab`.
 *
 * The Bitbucket-shaped quirk: all writes go through one endpoint. Creates,
 * updates, and deletes are folded into multipart `POST /src` payloads,
 * which means a future "transactional commit" (multiple files in one
 * commit) is a thin layer above `dataSource.commit({...})`. The current
 * repository surface stays one-file-at-a-time for API parity with the
 * other git platforms.
 */
export class BitbucketStorageRepository extends StorageRepository {
  private readonly dataSource: BitbucketDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly commitAuthor?: { readonly name: string, readonly email: string };
  private readonly determineExtension: DetermineExtension;

  constructor(options: BitbucketStorageRepositoryOptions) {
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
    this.defaultFileExtension = defaultFileExtension.startsWith('.')
      ? defaultFileExtension.slice(1)
      : defaultFileExtension;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.commitAuthor = commitAuthor;
    this.determineExtension = determineExtension;
    this.dataSource = new BitbucketDataSource(dataSourceOptions);
    this.excludeFilter = ignoreList
      .map(p => minimatch.makeRe(p, { dot: true, partial: true }))
      .filter((re): re is minimatch.MMRegExp => re !== false);
  }

  private resolveExtension(key: string, metadata: StorageObject['metadata'] | undefined): string {
    const requested = this.determineExtension(key, {
      metadata,
      defaultExtension: this.defaultFileExtension,
    });
    if (requested && this.serializerRegistry[requested]) return requested;
    return this.defaultFileExtension;
  }

  private stripExtension(path: string): string {
    for (const ext of this.availableExtensions) {
      if (path.endsWith(`.${ext}`)) return path.slice(0, -(ext.length + 1));
    }
    return path;
  }

  /** Try each registered extension and return the first that exists on the branch. */
  private async resolvePathWithExtension(
    key: string,
  ): Promise<LaikaResult<{ path: string, extension: string } | null>> {
    const base = this.stripExtension(key);
    const probes = await Promise.all(
      this.availableExtensions.map(async ext => {
        const meta = await this.dataSource.getFileMeta(`${base}.${ext}`);
        return { ext, meta };
      }),
    );
    for (const probe of probes) {
      if (Result.isFailure(probe.meta)) return Result.fail(probe.meta.failure);
      if (probe.meta.success) {
        return Result.succeed({ path: `${base}.${probe.ext}`, extension: probe.ext });
      }
    }
    return Result.succeed(null);
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

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* liftResult(this.resolvePathWithExtension(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const [meta, raw] = yield* Effect.all(
          [
            liftResult(this.dataSource.getFileMeta(resolved.path)),
            liftResult(this.dataSource.getFileContents(resolved.path)),
          ],
          { concurrency: 2 },
        );
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, raw));
        return {
          type: 'object',
          key: this.stripExtension(resolved.path),
          createdAt: meta?.createdAt?.toISOString(),
          updatedAt: meta?.updatedAt?.toISOString(),
          content,
          metadata: { extension: resolved.extension, revisionId: meta?.commit },
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
        const existing = yield* liftResult(this.resolvePathWithExtension(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const ext = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(ext, create.content));
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
        const resolved = yield* liftResult(this.resolvePathWithExtension(update.key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
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
        const existing = yield* liftResult(this.resolvePathWithExtension(create.key));
        const ext = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
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
        // Probing the listing is the cheapest way to confirm the directory exists.
        yield* liftResult(this.dataSource.listDirectory(key));
        const now = new Date(0).toISOString();
        return { type: 'folder', key, createdAt: now, updatedAt: now } satisfies Folder;
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        // Git tracks files, not folders — `.keep` is the convention this suite uses.
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
        // Bitbucket doesn't expose a cheap "is it a file or a directory" probe
        // other than fetching meta on the file vs listing the dir. Try the file
        // surface first; fall through to folder on a NotFoundError.
        const probe = yield* Effect.result(LaikaTask.runValue(this.getObject(key)));
        if (Result.isSuccess(probe)) return probe.success as Atom;
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
    { summaries: ReadonlyArray<AtomSummary>, missingFolder?: LaikaError },
    LaikaError
  > {
    return Effect.gen({ self: this }, function*() {
      const listing = yield* Effect.result(liftResult(this.dataSource.listDirectory(folderKey)));
      if (Result.isFailure(listing)) {
        if (listing.failure instanceof NotFoundError) {
          return { summaries: [] as ReadonlyArray<AtomSummary>, missingFolder: listing.failure };
        }
        return yield* Effect.fail(listing.failure);
      }
      const filtered = listing.success.filter(entry => this.excludeFilter.every(re => !re.test(entry.path)));
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
        return { type: entry.type === 'file' ? 'object-summary' : 'folder-summary', key };
      });
      return { summaries: applyPagination(summaries, options.pagination) };
    });
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const resolved = yield* Effect.result(liftResult(this.resolvePathWithExtension(key)));
          if (Result.isFailure(resolved)) {
            yield* emit.recoverableError(resolved.failure);
            skipped += 1;
            continue;
          }
          if (!resolved.success) {
            yield* emit.recoverableError(new NotFoundError(`No object found at key "${key}"`));
            skipped += 1;
            continue;
          }
          const deleted = yield* Effect.result(liftResult(
            this.dataSource.deleteFile(resolved.success.path, {
              commitMessage: `Delete ${resolved.success.path}`,
              author: this.commitAuthor,
            }),
          ));
          if (Result.isFailure(deleted)) {
            yield* emit.recoverableError(deleted.failure);
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
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description:
          'Stores each object as a file in the Bitbucket repository using any registered serializer extension.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over the Bitbucket tree listing; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
