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

import { GitlabDataSource, type GitlabDataSourceOptions } from './gitlab-datasource.js';

export interface GitlabStorageRepositoryOptions extends GitlabDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  /** Glob patterns to omit from directory listings. */
  readonly ignoreList?: readonly string[];
  /** Optional `author_name`/`author_email` attached to every commit. */
  readonly commitAuthor?: { readonly name: string, readonly email: string };
  /** Strategy for picking the on-server extension when creating an object. */
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
 * A {@link StorageRepository} backed by a GitLab project, talking the REST v4
 * API. Stores each object as a file in the project's repository on a fixed
 * branch; reads and writes are commits attributed to the authenticated user
 * (or to {@link GitlabStorageRepositoryOptions.commitAuthor} when supplied).
 *
 * Parallels {@link @laikacms/github}'s `GithubStorageRepository`. The
 * difference is auth: GitLab PATs/OAuth tokens are long-lived so there is no
 * App installation flow — bring a token, point at a project, and write.
 *
 * Runtime-agnostic: only depends on `fetch`. Works on Node, Bun, Deno,
 * Cloudflare Workers, and the browser.
 */
export class GitlabStorageRepository extends StorageRepository {
  private readonly dataSource: GitlabDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly commitAuthor?: { readonly name: string, readonly email: string };
  private readonly determineExtension: DetermineExtension;

  constructor(options: GitlabStorageRepositoryOptions) {
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
    this.dataSource = new GitlabDataSource(dataSourceOptions);
    this.excludeFilter = ignoreList
      .map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true }))
      .filter((re): re is minimatch.MMRegExp => re !== false);
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

  private stripExtension(path: string): string {
    for (const ext of this.availableExtensions) {
      if (path.endsWith(`.${ext}`)) return path.slice(0, -(ext.length + 1));
    }
    return path;
  }

  /** Probe each registered extension to find the on-server file for an extension-free key. */
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
        const resolved = yield* Effect.promise(() => this.resolvePathWithExtension(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const [contents, meta] = yield* Effect.all(
          [
            liftResult(this.dataSource.getFileContents(resolved.path)),
            liftResult(this.dataSource.getFileMeta(resolved.path)),
          ],
          { concurrency: 2 },
        );
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, contents.content));
        return {
          type: 'object',
          key: this.stripExtension(resolved.path),
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
          content,
          metadata: { extension: resolved.extension, revisionId: meta.lastCommitId },
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
        const resolved = yield* Effect.promise(() => this.resolvePathWithExtension(update.key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(resolved.extension, update.content!));
          yield* liftResult(
            this.dataSource.createOrUpdate(resolved.path, serialized, {
              expectedLastCommitId: update.metadata?.revisionId,
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
        // When metadata pins an extension, honour it — don't let a stale file
        // at a different extension capture the write.
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
        // Probing the listing is the cheapest way to confirm the directory
        // exists — GitLab has no first-class "stat directory" call.
        yield* liftResult(this.dataSource.listDirectory(key));
        const now = new Date(0).toISOString();
        return { type: 'folder', key, createdAt: now, updatedAt: now } satisfies Folder;
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        // Git tracks files, not directories — write a `.keep` so the folder
        // exists at all. Mirrors the github/storage-fs convention.
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
        const typed = yield* Effect.result(
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
        // pathType NotFound → fall back to a getObject probe (the path may
        // be a key without its on-server extension).
        if (typed._tag === 'Failure') {
          return yield* LaikaTask.runValue(this.getObject(key));
        }
        if (typed.success === 'file') {
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
          const resolved = yield* Effect.promise(() => this.resolvePathWithExtension(key));
          if (!resolved) {
            yield* emit.recoverableError(new NotFoundError(`No object found at key "${key}"`));
            skipped += 1;
            continue;
          }
          const deleted = yield* Effect.result(
            liftResult(
              this.dataSource.deleteFile(resolved.path, {
                commitMessage: `Delete ${resolved.path}`,
                author: this.commitAuthor,
              }),
            ),
          );
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
      compatibilityDate: CompatibilityDate.make('2026-05-19'),
      fileExtensions: {
        supported: true,
        description: 'Stores each object as a file in the GitLab project using any registered serializer extension.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over the GitLab tree listing; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
