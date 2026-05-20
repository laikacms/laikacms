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
  pathCombine,
  StorageRepository,
} from 'laikacms/storage';

import {
  decodeGistFilename,
  encodeGistFilename,
  GistDataSource,
  type GistDataSourceOptions,
  type GistFile,
} from './gist-datasource.js';

export interface GistStorageRepositoryOptions extends GistDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/**
 * A {@link StorageRepository} backed by a single GitHub Gist. Each Laika
 * storage object becomes one file inside the gist; deletes, updates, and
 * creates all go through the same `PATCH /gists/{id}` endpoint with the
 * full file delta — so the underlying data source exposes an atomic
 * multi-file commit primitive (`commit({files: {a: {...}, b: null}})`),
 * the same shape as Bitbucket's `POST /src` (iter 14) and Sanity's
 * `/mutate` (iter 17).
 *
 * Filename quirk: GitHub forbids `/` in gist filenames, so the data
 * source encodes `notes/hello.md` → `notes__hello.md` on the wire.
 * Caller-facing keys keep the slash; the on-gist filename is the encoded
 * form. Keys that literally contain the two-character `__` sequence are
 * rejected upfront with `BadRequestError` so the round-trip stays
 * unambiguous.
 *
 * Other constraints:
 *
 * - **One gist per repository instance.** Add multiple gists by
 *   instantiating multiple repositories; gists are bounded by GitHub at
 *   ~300 files / ~1MB per gist, so this is the right unit of separation.
 * - **No real folders.** Folders are simulated via `.keep` placeholders
 *   under encoded prefixes, matching the storage-s3 / storage-r2 pattern.
 * - **No OCC.** Gist's PATCH endpoint accepts no `If-Match` or version
 *   parameter; updates are last-writer-wins.
 *
 * Runtime-agnostic — only depends on `fetch`.
 */
export class GistStorageRepository extends StorageRepository {
  private readonly dataSource: GistDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: GistStorageRepositoryOptions) {
    super();
    this.dataSource = new GistDataSource(options);
    this.serializerRegistry = options.serializerRegistry;
    this.defaultFileExtension = options.defaultFileExtension.startsWith('.')
      ? options.defaultFileExtension.slice(1)
      : options.defaultFileExtension;
    this.availableExtensions = Object.keys(options.serializerRegistry);
    this.determineExtension = options.determineExtension ?? defaultDetermineExtension;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Refuse keys with `__` — that token is reserved as the slash encoding. */
  private validateKey(key: string): LaikaResult<string> {
    const trimmed = trimSlashes(key);
    if (trimmed.includes('__')) {
      return Result.fail(new BadRequestError(
        `Gist storage keys cannot contain the literal "__" sequence (it's reserved as the slash encoding); got "${key}"`,
      ));
    }
    return Result.succeed(trimmed);
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

  /** Probe the gist's file map for a `<key>.<ext>` match in any registered extension. */
  private findFileFor(key: string, files: Record<string, GistFile>): { file: GistFile; extension: string } | null {
    const encoded = encodeGistFilename(key);
    for (const ext of this.availableExtensions) {
      const want = `${encoded}.${ext}`;
      const hit = files[want];
      if (hit) return { file: hit, extension: ext };
    }
    return null;
  }

  /**
   * Fetch the file's actual content. GitHub may truncate large files in the
   * gist listing — for those the data source fetches the `raw_url` separately.
   */
  private async resolveContent(file: GistFile): Promise<LaikaResult<string>> {
    if (file.truncated && file.raw_url) {
      return await this.dataSource.fetchRaw(file.raw_url);
    }
    return Result.succeed(file.content ?? '');
  }

  // -----------------------------------------------------------------------
  // StorageRepository implementation
  // -----------------------------------------------------------------------

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const validated = yield* Effect.fromResult(this.validateKey(key));
        const gist = yield* liftResult(this.dataSource.getGist());
        const hit = this.findFileFor(validated, gist.files);
        if (!hit) return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        const raw = yield* liftResult(this.resolveContent(hit.file));
        const content = yield* Effect.promise(() => this.deserialize(hit.extension, raw));
        return {
          type: 'object',
          key: validated,
          createdAt: gist.created_at,
          updatedAt: gist.updated_at,
          content,
          metadata: { extension: hit.extension, revisionId: gist.history?.[0]?.version },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const validated = yield* Effect.fromResult(this.validateKey(key));
        if (validated === '') {
          return { type: 'folder', key: '' } satisfies Folder;
        }
        const gist = yield* liftResult(this.dataSource.getGist());
        const encodedPrefix = encodeGistFilename(validated) + '__';
        // A folder "exists" if there's at least one file under its encoded prefix.
        const hasAny = Object.keys(gist.files).some(name => name.startsWith(encodedPrefix));
        if (!hasAny) return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        return {
          type: 'folder',
          key: validated,
          createdAt: gist.created_at,
          updatedAt: gist.updated_at,
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const validated = yield* Effect.fromResult(this.validateKey(key));
        if (validated === '') {
          return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
        }
        const gist = yield* liftResult(this.dataSource.getGist());
        if (this.findFileFor(validated, gist.files)) {
          return yield* LaikaTask.runValue(this.getObject(key)) as Effect.Effect<Atom, LaikaError>;
        }
        return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required for creation'));
        }
        const validated = yield* Effect.fromResult(this.validateKey(create.key));
        if (validated === '') {
          return yield* Effect.fail(new BadRequestError('Cannot create the storage root as an object'));
        }
        const gist = yield* liftResult(this.dataSource.getGist());
        const existing = this.findFileFor(validated, gist.files);
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const filename = `${encodeGistFilename(validated)}.${extension}`;
        yield* liftResult(this.dataSource.commit({ [filename]: { content: serialized } }));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const validated = yield* Effect.fromResult(this.validateKey(update.key));
        const gist = yield* liftResult(this.dataSource.getGist());
        const existing = this.findFileFor(validated, gist.files);
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension, update.content!));
          const filename = `${encodeGistFilename(validated)}.${existing.extension}`;
          yield* liftResult(this.dataSource.commit({ [filename]: { content: serialized } }));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const validated = yield* Effect.fromResult(this.validateKey(create.key));
        const gist = yield* liftResult(this.dataSource.getGist());
        const existing = this.findFileFor(validated, gist.files);
        if (existing) {
          return yield* LaikaTask.runValue(this.updateObject({ key: validated, content: create.content }));
        }
        return yield* LaikaTask.runValue(this.createObject(create));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const validated = yield* Effect.fromResult(this.validateKey(folderCreate.key));
        if (validated === '') {
          return { type: 'folder', key: '' } satisfies Folder;
        }
        // Drop a `.keep` placeholder so the folder is visible in listings.
        const keepFilename = encodeGistFilename(pathCombine(validated, '.keep'));
        yield* liftResult(this.dataSource.commit({ [keepFilename]: { content: '' } }));
        return { type: 'folder', key: validated } satisfies Folder;
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        if (keys.length === 0) return { removed, skipped };

        const gistResult = yield* Effect.result(liftResult(this.dataSource.getGist()));
        if (Result.isFailure(gistResult)) {
          for (const _ of keys) {
            yield* emit.recoverableError(gistResult.failure);
            skipped += 1;
          }
          return { removed, skipped };
        }
        const gist = gistResult.success;

        // Build the file-delta map for one atomic PATCH. Tracks per-key
        // resolution so we can emit per-key results after the commit lands.
        const deletions: Record<string, null> = {};
        const queuedKeys: string[] = [];
        for (const key of keys) {
          const validated = this.validateKey(key);
          if (Result.isFailure(validated)) {
            yield* emit.recoverableError(validated.failure);
            skipped += 1;
            continue;
          }
          if (validated.success === '') {
            yield* emit.recoverableError(new ForbiddenError('Refusing to delete the storage root'));
            skipped += 1;
            continue;
          }
          const fileHit = this.findFileFor(validated.success, gist.files);
          if (fileHit) {
            const filename = `${encodeGistFilename(validated.success)}.${fileHit.extension}`;
            deletions[filename] = null;
            queuedKeys.push(validated.success);
            continue;
          }
          // Folder delete? Refuse non-empty.
          const encodedPrefix = encodeGistFilename(validated.success) + '__';
          const childKeys = Object.keys(gist.files).filter(n => n.startsWith(encodedPrefix));
          if (childKeys.length === 0) {
            yield* emit.recoverableError(new NotFoundError(`No atom found at key "${key}"`));
            skipped += 1;
            continue;
          }
          const nonKeep = childKeys.filter(n => !n.endsWith('__.keep') && n !== `${encodedPrefix}.keep`);
          if (nonKeep.length > 0) {
            yield* emit.recoverableError(new ForbiddenError(`Refusing to delete non-empty folder "${key}"`));
            skipped += 1;
            continue;
          }
          // Empty folder — drop the keep placeholder(s).
          for (const n of childKeys) deletions[n] = null;
          queuedKeys.push(validated.success);
        }

        if (Object.keys(deletions).length === 0) {
          return { removed, skipped };
        }

        const committed = yield* Effect.result(liftResult(this.dataSource.commit(deletions)));
        if (Result.isFailure(committed)) {
          for (const _ of queuedKeys) {
            yield* emit.recoverableError(committed.failure);
            skipped += 1;
          }
          return { removed, skipped };
        }
        for (const key of queuedKeys) {
          yield* emit.data(key);
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
      const validated = yield* Effect.fromResult(this.validateKey(folderKey));
      const gist = yield* liftResult(this.dataSource.getGist());

      // Build the listing client-side from the single getGist response.
      const prefix = validated === '' ? '' : `${encodeGistFilename(validated)}__`;
      const folderSet = new Set<string>();
      const objectSet = new Set<string>();

      for (const encodedFilename of Object.keys(gist.files)) {
        if (validated !== '' && !encodedFilename.startsWith(prefix)) continue;
        const relativeEncoded = validated === '' ? encodedFilename : encodedFilename.slice(prefix.length);
        const decoded = decodeGistFilename(relativeEncoded);
        const slash = decoded.indexOf('/');
        if (slash === -1) {
          // Direct file child — strip extension.
          if (decoded === '.keep') continue;
          const bareName = this.stripExtension(decoded);
          objectSet.add(bareName);
        } else {
          // Nested — surface the immediate subfolder.
          folderSet.add(decoded.slice(0, slash));
        }
      }

      if (validated !== '' && folderSet.size === 0 && objectSet.size === 0) {
        return {
          summaries: [] as ReadonlyArray<AtomSummary>,
          missingFolder: new NotFoundError(`No folder found at key "${folderKey}"`),
        };
      }

      const summaries: AtomSummary[] = [
        ...[...folderSet].map(name => ({
          type: 'folder-summary' as const,
          key: validated === '' ? name : `${validated}/${name}`,
        })),
        ...[...objectSet].map(name => ({
          type: 'object-summary' as const,
          key: validated === '' ? name : `${validated}/${name}`,
        })),
      ];
      const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(sorted, options.pagination) };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Stores each object as a file inside a single GitHub Gist; slashes in keys are encoded as `__`.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over the gist\'s flat file map; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
