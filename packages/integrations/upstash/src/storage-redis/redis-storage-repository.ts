import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  ForbiddenError,
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

import {
  type RedisCommandResult,
  UpstashRedisDataSource,
  type UpstashRedisDataSourceOptions,
} from './redis-datasource.js';

export interface UpstashRedisStorageRepositoryOptions extends UpstashRedisDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  /**
   * Namespace prefix for every Redis key this repository touches. Defaults to
   * `laika:storage`. Set this per tenant for multi-tenant deployments.
   */
  readonly namespace?: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/**
 * A {@link StorageRepository} backed by Redis via the
 * [Upstash REST API](https://upstash.com/docs/redis/features/restapi). Designed
 * for edge deployments where a TCP connection to Redis is not available but
 * HTTPS is — Cloudflare Workers, Vercel Edge, Deno Deploy.
 *
 * Key layout (configurable namespace, defaults to `laika:storage`):
 *
 *     <namespace>:file:<path>.<ext>   → serialized content as the Redis value
 *     <namespace>:folder:<path>       → empty marker so empty folders exist
 *
 * Listing a folder uses `SCAN MATCH <namespace>:{file,folder}:<folder>/*`
 * twice — once for files, once for folders — and groups results client-side
 * by their next path segment, so both direct files and direct sub-folders
 * surface correctly. Finding an extension-free key issues one pipelined
 * `EXISTS` per registered serializer extension in a single round-trip.
 *
 * Trade-offs:
 *
 * - Redis values are strings, not objects — the repository serializes
 *   content with the registered serializers (same as every other
 *   `StorageRepository` in the suite) and stores the resulting string.
 * - `SCAN` is best-effort: it guarantees every key surviving the whole
 *   scan is returned at least once, but may return duplicates if keys are
 *   modified mid-scan. The repository deduplicates client-side.
 */
export class UpstashRedisStorageRepository extends StorageRepository {
  private readonly dataSource: UpstashRedisDataSource;
  private readonly namespace: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: UpstashRedisStorageRepositoryOptions) {
    super();
    const {
      serializerRegistry,
      defaultFileExtension,
      namespace = 'laika:storage',
      determineExtension = defaultDetermineExtension,
      ...dataSourceOptions
    } = options;
    this.dataSource = new UpstashRedisDataSource(dataSourceOptions);
    this.namespace = namespace.replace(/:+$/, '');
    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultFileExtension.startsWith('.')
      ? defaultFileExtension.slice(1)
      : defaultFileExtension;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.determineExtension = determineExtension;
  }

  // -----------------------------------------------------------------------
  // Key construction
  // -----------------------------------------------------------------------

  private fileKey(path: string, extension: string): string {
    return `${this.namespace}:file:${trimSlashes(path)}.${extension}`;
  }

  private folderKey(path: string): string {
    return `${this.namespace}:folder:${trimSlashes(path)}`;
  }

  private filePattern(folder: string): string {
    const trimmed = trimSlashes(folder);
    return trimmed === ''
      ? `${this.namespace}:file:*`
      : `${this.namespace}:file:${trimmed}/*`;
  }

  private folderPattern(folder: string): string {
    const trimmed = trimSlashes(folder);
    return trimmed === ''
      ? `${this.namespace}:folder:*`
      : `${this.namespace}:folder:${trimmed}/*`;
  }

  /** Strip the namespace+kind prefix off a Redis key, returning the relative path. */
  private relativePath(redisKey: string, kind: 'file' | 'folder'): string | undefined {
    const prefix = `${this.namespace}:${kind}:`;
    return redisKey.startsWith(prefix) ? redisKey.slice(prefix.length) : undefined;
  }

  // -----------------------------------------------------------------------
  // Serialization plumbing (same shape as every other StorageRepository)
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Existence probes
  // -----------------------------------------------------------------------

  /**
   * Pipeline an `EXISTS` for each registered extension against the path's
   * `<namespace>:file:<key>.<ext>` form — one HTTP round-trip resolves the
   * extension regardless of how many serializers are registered.
   */
  private async findExistingExtension(key: string): Promise<LaikaResult<string | null>> {
    const path = trimSlashes(key);
    const commands = this.availableExtensions.map(ext => ['EXISTS', this.fileKey(path, ext)] as const);
    const piped = await this.dataSource.pipeline<number>(commands);
    if (Result.isFailure(piped)) return Result.fail(piped.failure);
    for (let i = 0; i < piped.success.length; i++) {
      const entry = piped.success[i] as RedisCommandResult<number>;
      if (entry.error) continue;
      if ((entry.result ?? 0) > 0) return Result.succeed(this.availableExtensions[i]);
    }
    return Result.succeed(null);
  }

  /** Ensure folder markers exist for every ancestor of `folderKey`. */
  private async ensureFolderChain(folderKey: string): Promise<LaikaResult<void>> {
    const trimmed = trimSlashes(folderKey);
    if (trimmed === '') return Result.succeed(undefined);
    const segments = trimmed.split('/');
    const commands: (readonly string[])[] = [];
    for (let i = 0; i < segments.length; i++) {
      commands.push(['SET', this.folderKey(segments.slice(0, i + 1).join('/')), '']);
    }
    const piped = await this.dataSource.pipeline(commands);
    if (Result.isFailure(piped)) return Result.fail(piped.failure);
    return Result.succeed(undefined);
  }

  // -----------------------------------------------------------------------
  // StorageRepository implementation
  // -----------------------------------------------------------------------

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const extension = yield* liftResult(this.findExistingExtension(key));
        if (!extension) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const raw = yield* liftResult(this.dataSource.run<string | null>(['GET', this.fileKey(key, extension)]));
        if (raw === null) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const content = yield* Effect.promise(() => this.deserialize(extension, raw));
        return {
          type: 'object',
          key: trimSlashes(key),
          content,
          metadata: { extension },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed !== '') {
          const exists = yield* liftResult(
            this.dataSource.run<number>(['EXISTS', this.folderKey(trimmed)]),
          );
          if ((exists ?? 0) === 0) {
            return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
          }
        }
        return { type: 'folder', key: trimmed } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed !== '') {
          const folderExists = yield* liftResult(
            this.dataSource.run<number>(['EXISTS', this.folderKey(trimmed)]),
          );
          if ((folderExists ?? 0) > 0) {
            return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
          }
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
        const existing = yield* liftResult(this.findExistingExtension(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const parent = parentOf(create.key);
        if (parent !== '') yield* liftResult(this.ensureFolderChain(parent));
        yield* liftResult(this.dataSource.run(['SET', this.fileKey(create.key, extension), serialized]));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.findExistingExtension(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(existing, update.content!));
          yield* liftResult(this.dataSource.run(['SET', this.fileKey(update.key, existing), serialized]));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.findExistingExtension(create.key));
        const extension = existing ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const parent = parentOf(create.key);
        if (parent !== '') yield* liftResult(this.ensureFolderChain(parent));
        yield* liftResult(this.dataSource.run(['SET', this.fileKey(create.key, extension), serialized]));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.ensureFolderChain(folderCreate.key));
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
          const trimmed = trimSlashes(key);

          // Is `key` a folder?
          const folderExists = yield* Effect.result(liftResult(
            this.dataSource.run<number>(['EXISTS', this.folderKey(trimmed)]),
          ));
          if (Result.isFailure(folderExists)) {
            yield* emit.recoverableError(folderExists.failure);
            skipped += 1;
            continue;
          }
          if ((folderExists.success ?? 0) > 0) {
            const fileChildren = yield* Effect.result(
              liftResult(this.dataSource.scanAll(this.filePattern(trimmed))),
            );
            const folderChildren = yield* Effect.result(
              liftResult(this.dataSource.scanAll(this.folderPattern(trimmed))),
            );
            if (Result.isFailure(fileChildren) || Result.isFailure(folderChildren)) {
              yield* emit.recoverableError(
                Result.isFailure(fileChildren)
                  ? fileChildren.failure
                  : (folderChildren as Result.Failure<never, LaikaError>).failure,
              );
              skipped += 1;
              continue;
            }
            if (fileChildren.success.length > 0 || folderChildren.success.length > 0) {
              yield* emit.recoverableError(
                new ForbiddenError(`Refusing to delete non-empty folder "${key}"`),
              );
              skipped += 1;
              continue;
            }
            const deleted = yield* Effect.result(
              liftResult(this.dataSource.run<number>(['DEL', this.folderKey(trimmed)])),
            );
            if (Result.isFailure(deleted)) {
              yield* emit.recoverableError(deleted.failure);
              skipped += 1;
            } else {
              yield* emit.data(trimmed);
              removed += 1;
            }
            continue;
          }

          // Otherwise resolve as a file under one of the registered extensions.
          const extension = yield* Effect.result(liftResult(this.findExistingExtension(key)));
          if (Result.isFailure(extension)) {
            yield* emit.recoverableError(extension.failure);
            skipped += 1;
            continue;
          }
          if (!extension.success) {
            yield* emit.recoverableError(new NotFoundError(`No atom found at key "${key}"`));
            skipped += 1;
            continue;
          }
          const deleted = yield* Effect.result(
            liftResult(this.dataSource.run<number>(['DEL', this.fileKey(key, extension.success)])),
          );
          if (Result.isFailure(deleted)) {
            yield* emit.recoverableError(deleted.failure);
            skipped += 1;
          } else {
            yield* emit.data(trimmed);
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
    { summaries: ReadonlyArray<AtomSummary>, missingFolder?: LaikaError },
    LaikaError
  > {
    return Effect.gen({ self: this }, function*() {
      const trimmed = trimSlashes(folderKey);

      // Confirm the parent folder exists (root is always implicit).
      if (trimmed !== '') {
        const exists = yield* liftResult(
          this.dataSource.run<number>(['EXISTS', this.folderKey(trimmed)]),
        );
        if ((exists ?? 0) === 0) {
          // Empty might still be valid if files live underneath without a
          // folder marker (defensive), but for correctness we treat missing
          // markers as a missing folder.
          return {
            summaries: [] as ReadonlyArray<AtomSummary>,
            missingFolder: new NotFoundError(`No folder found at key "${folderKey}"`),
          };
        }
      }

      const fileKeys = yield* liftResult(this.dataSource.scanAll(this.filePattern(trimmed)));
      const folderKeys = yield* liftResult(this.dataSource.scanAll(this.folderPattern(trimmed)));

      // Deduplicate (SCAN may return duplicates).
      const seenFiles = new Set<string>();
      const seenFolders = new Set<string>();

      for (const fk of fileKeys) {
        const rel = this.relativePath(fk, 'file');
        if (rel === undefined) continue;
        const sub = trimmed === '' ? rel : rel.slice(trimmed.length + 1);
        if (sub.includes('/')) {
          // Nested file → its first segment is an implicit folder child.
          seenFolders.add(sub.split('/')[0]);
        } else {
          // Direct file child — strip extension.
          for (const ext of this.availableExtensions) {
            if (sub.endsWith(`.${ext}`)) {
              seenFiles.add(sub.slice(0, -(ext.length + 1)));
              break;
            }
          }
        }
      }
      for (const fk of folderKeys) {
        const rel = this.relativePath(fk, 'folder');
        if (rel === undefined) continue;
        const sub = trimmed === '' ? rel : rel.slice(trimmed.length + 1);
        const head = sub.split('/')[0];
        if (head !== '') seenFolders.add(head);
      }

      const summaries: AtomSummary[] = [
        ...[...seenFiles].map(name => ({
          type: 'object-summary' as const,
          key: trimmed === '' ? name : `${trimmed}/${name}`,
        })),
        ...[...seenFolders].map(name => ({
          type: 'folder-summary' as const,
          key: trimmed === '' ? name : `${trimmed}/${name}`,
        })),
      ];
      const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(sorted, options.pagination) };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-19'),
      fileExtensions: {
        supported: true,
        description: 'Stores each object as a Redis string keyed by `<namespace>:file:<path>.<ext>`.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over `SCAN`; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}

/** Return the parent path of `key`, or the empty string for a root-level key. */
const parentOf = (key: string): string => {
  const trimmed = trimSlashes(key);
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? '' : trimmed.slice(0, idx);
};
