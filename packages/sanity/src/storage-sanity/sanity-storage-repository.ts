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
  type SanityDataSourceOptions,
  type SanityDocument,
  type SanityMutation,
  SanityDataSource,
  TYPE_FILE,
  TYPE_FOLDER,
} from './sanity-datasource.js';

export interface SanityStorageRepositoryOptions extends SanityDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitKey = (key: string): { parent: string; name: string } => {
  const k = trimSlashes(key);
  const idx = k.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: k } : { parent: k.slice(0, idx), name: k.slice(idx + 1) };
};

/**
 * A {@link StorageRepository} backed by Sanity. Documents of two types power
 * the model:
 *
 *     _type: 'laikaFolder'        a folder marker
 *     _type: 'laikaObject'        a stored object
 *
 * Both carry `parent` (the parent path), `name` (basename — includes the
 * extension for files), and `path` (the full storage key). Files also carry
 * `extension` and `content` (the serialized string). `_id` is the SHA-256
 * hex digest of the full path — Sanity document ids forbid `/`, so an
 * encoding is required. Override `idFor` in the data-source options if you
 * want round-trippable ids.
 *
 * Two Sanity API endpoints carry all the work:
 *
 * - **GROQ for reads.** Listing a folder is one `*[_type in [...] && parent
 *   == $parent]` query — direct children only, no client-side filtering.
 * - **Transactional `/mutate` for writes.** `createObject` ships
 *   `[createOrReplace folderMarker, createOrReplace folderMarker, ..., create
 *   file]` in **one atomic transaction**: deep keys + ancestor folders
 *   commit together or not at all.
 *
 * Optimistic concurrency via Sanity's `_rev` is exposed through
 * `metadata.revisionId`; `updateObject` round-trips it as `ifRevisionID` on
 * the patch, so concurrent edits surface as `VersionMismatchError`.
 *
 * Runtime-agnostic — only depends on `fetch` and Web Crypto.
 */
export class SanityStorageRepository extends StorageRepository {
  private readonly dataSource: SanityDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: SanityStorageRepositoryOptions) {
    super();
    this.dataSource = new SanityDataSource(options);
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

  private fullPath(parent: string, name: string): string {
    return parent === '' ? name : `${parent}/${name}`;
  }

  /**
   * Resolve an extension-free key to its on-Sanity document in one round-trip:
   * GROQ `name in [<key>.<ext1>, <key>.<ext2>, ...]`. Returns `null` when
   * nothing matches.
   */
  private async findExistingFile(
    key: string,
  ): Promise<LaikaResult<{ doc: SanityDocument; extension: string } | null>> {
    const { parent, name } = splitKey(key);
    if (name === '') return Result.succeed(null);
    const candidates = this.availableExtensions.map(ext => `${name}.${ext}`);
    const queried = await this.dataSource.query<SanityDocument[]>(
      `*[_type == $type && parent == $parent && name in $names][0..1]`,
      { type: TYPE_FILE, parent, names: candidates },
    );
    if (Result.isFailure(queried)) return Result.fail(queried.failure);
    const hit = queried.success[0];
    if (!hit) return Result.succeed(null);
    const extension = typeof hit.extension === 'string' ? hit.extension : '';
    if (!this.availableExtensions.includes(extension)) return Result.succeed(null);
    return Result.succeed({ doc: hit, extension });
  }

  /** Build the mutation list that ensures every ancestor folder exists. */
  private async ancestorFolderMutations(parent: string): Promise<SanityMutation[]> {
    const trimmed = trimSlashes(parent);
    if (trimmed === '') return [];
    const segments = trimmed.split('/');
    const out: SanityMutation[] = [];
    for (let i = 0; i < segments.length; i++) {
      const ancestorParent = segments.slice(0, i).join('/');
      const ancestorName = segments[i];
      const ancestorPath = this.fullPath(ancestorParent, ancestorName);
      const ancestorId = await this.dataSource.idFor(ancestorPath);
      out.push({
        createIfNotExists: {
          _id: ancestorId,
          _type: TYPE_FOLDER,
          parent: ancestorParent,
          name: ancestorName,
          path: ancestorPath,
        },
      });
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // StorageRepository implementation
  // -----------------------------------------------------------------------

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const found = yield* liftResult(this.findExistingFile(key));
        if (!found) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const content = yield* Effect.promise(() =>
          this.deserialize(found.extension, String(found.doc.content ?? '')),
        );
        return {
          type: 'object',
          key: trimSlashes(key),
          createdAt: found.doc._createdAt,
          updatedAt: found.doc._updatedAt,
          content,
          metadata: { extension: found.extension, revisionId: found.doc._rev },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '') {
          return { type: 'folder', key: '' } satisfies Folder;
        }
        const { parent, name } = splitKey(trimmed);
        const found = yield* liftResult(this.dataSource.query<SanityDocument[]>(
          `*[_type == $type && parent == $parent && name == $name][0..0]`,
          { type: TYPE_FOLDER, parent, name },
        ));
        const doc = found[0];
        if (!doc) return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        return {
          type: 'folder',
          key: trimmed,
          createdAt: doc._createdAt,
          updatedAt: doc._updatedAt,
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '') {
          return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
        }
        const { parent, name } = splitKey(trimmed);
        const found = yield* liftResult(this.dataSource.query<SanityDocument[]>(
          `*[(_type == $folder || _type == $file) && parent == $parent && (name == $name || name match $namePattern)][0..0]`,
          { folder: TYPE_FOLDER, file: TYPE_FILE, parent, name, namePattern: `${name}.*` },
        ));
        const doc = found[0];
        if (doc?._type === TYPE_FOLDER) {
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
        const existing = yield* liftResult(this.findExistingFile(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const { parent, name } = splitKey(create.key);
        if (name === '') {
          return yield* Effect.fail(new BadRequestError('Cannot create the storage root as an object'));
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const filePath = create.key;
        const fileId = yield* Effect.promise(() => this.dataSource.idFor(trimSlashes(filePath)));

        // Ancestor folders + file in one atomic transaction.
        const mutations: SanityMutation[] = [
          ...(yield* Effect.promise(() => this.ancestorFolderMutations(parent))),
          {
            create: {
              _id: fileId,
              _type: TYPE_FILE,
              parent,
              name: `${name}.${extension}`,
              path: trimSlashes(filePath),
              extension,
              content: serialized,
            },
          },
        ];
        yield* liftResult(this.dataSource.mutate(mutations));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.findExistingFile(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension, update.content!));
          // Pass back `_rev` via `ifRevisionID` when the caller supplied one —
          // Sanity rejects with 409 if anything else has touched the doc.
          const ifRevisionID = update.metadata?.revisionId;
          const patch: {
            id: string;
            set?: Record<string, unknown>;
            ifRevisionID?: string;
          } = { id: existing.doc._id, set: { content: serialized } };
          if (ifRevisionID) patch.ifRevisionID = ifRevisionID;
          yield* liftResult(this.dataSource.mutate([{ patch }]));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.findExistingFile(create.key));
        if (existing) {
          return yield* LaikaTask.runValue(this.updateObject({ key: create.key, content: create.content }));
        }
        return yield* LaikaTask.runValue(this.createObject(create));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(folderCreate.key);
        if (trimmed === '') return { type: 'folder', key: '' } satisfies Folder;
        const mutations = yield* Effect.promise(() => this.ancestorFolderMutations(trimmed));
        yield* liftResult(this.dataSource.mutate(mutations));
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
          if (trimmed === '') {
            yield* emit.recoverableError(new ForbiddenError('Refusing to delete the storage root'));
            skipped += 1;
            continue;
          }
          const { parent, name } = splitKey(trimmed);

          // Folder marker?
          const folderQuery = yield* Effect.result(liftResult(this.dataSource.query<SanityDocument[]>(
            `*[_type == $type && parent == $parent && name == $name][0..0]`,
            { type: TYPE_FOLDER, parent, name },
          )));
          if (Result.isFailure(folderQuery)) {
            yield* emit.recoverableError(folderQuery.failure);
            skipped += 1;
            continue;
          }
          const folderDoc = folderQuery.success[0];
          if (folderDoc) {
            const children = yield* Effect.result(liftResult(this.dataSource.query<SanityDocument[]>(
              `*[(_type == $folder || _type == $file) && parent == $parent][0..0]`,
              { folder: TYPE_FOLDER, file: TYPE_FILE, parent: trimmed },
            )));
            if (Result.isFailure(children)) {
              yield* emit.recoverableError(children.failure);
              skipped += 1;
              continue;
            }
            if (children.success.length > 0) {
              yield* emit.recoverableError(new ForbiddenError(`Refusing to delete non-empty folder "${key}"`));
              skipped += 1;
              continue;
            }
            const deleted = yield* Effect.result(liftResult(
              this.dataSource.mutate([{ delete: { id: folderDoc._id } }]),
            ));
            if (Result.isFailure(deleted)) {
              yield* emit.recoverableError(deleted.failure);
              skipped += 1;
            } else {
              yield* emit.data(trimmed);
              removed += 1;
            }
            continue;
          }

          // Otherwise resolve as a file with extension.
          const file = yield* Effect.result(liftResult(this.findExistingFile(key)));
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
          const deleted = yield* Effect.result(liftResult(
            this.dataSource.mutate([{ delete: { id: file.success.doc._id } }]),
          ));
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
    { summaries: ReadonlyArray<AtomSummary>; missingFolder?: LaikaError },
    LaikaError
  > {
    return Effect.gen({ self: this }, function*() {
      const trimmed = trimSlashes(folderKey);

      if (trimmed !== '') {
        const folderQuery = yield* liftResult(this.dataSource.query<SanityDocument[]>(
          `*[_type == $type && path == $path][0..0]`,
          { type: TYPE_FOLDER, path: trimmed },
        ));
        if (folderQuery.length === 0) {
          return {
            summaries: [] as ReadonlyArray<AtomSummary>,
            missingFolder: new NotFoundError(`No folder found at key "${folderKey}"`),
          };
        }
      }

      const children = yield* liftResult(this.dataSource.query<SanityDocument[]>(
        `*[(_type == $folder || _type == $file) && parent == $parent]`,
        { folder: TYPE_FOLDER, file: TYPE_FILE, parent: trimmed },
      ));
      const summaries: AtomSummary[] = children.map((doc): AtomSummary => {
        const name = String(doc.name ?? '');
        const fullKey = trimmed === '' ? name : `${trimmed}/${name}`;
        if (doc._type === TYPE_FOLDER) {
          return { type: 'folder-summary', key: fullKey };
        }
        const ext = typeof doc.extension === 'string' ? doc.extension : '';
        const bareKey = ext && fullKey.endsWith(`.${ext}`)
          ? fullKey.slice(0, -(ext.length + 1))
          : fullKey;
        return { type: 'object-summary', key: bareKey };
      });
      const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(sorted, options.pagination) };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Stores each object as a Sanity document of `_type: \'laikaObject\'` with a serialized `content` field.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over a GROQ `*[…&& parent == $parent]` query; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
