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
  AlgoliaDataSource,
  type AlgoliaDataSourceOptions,
  type AlgoliaRecord,
  CONTENT_ATTR,
  EXTENSION_ATTR,
  PARENT_ATTR,
  TYPE_ATTR,
} from './algolia-datasource.js';

export interface AlgoliaStorageRepositoryOptions extends AlgoliaDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/** Split a path into `(parent, name)`. The empty key has parent `''` and name `''`. */
const splitKey = (key: string): { parent: string, name: string } => {
  const k = trimSlashes(key);
  const idx = k.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: k } : { parent: k.slice(0, idx), name: k.slice(idx + 1) };
};

/**
 * A {@link StorageRepository} backed by a single Algolia index.
 *
 * Each record carries four reserved attributes:
 *
 *     _type     "file" | "folder"
 *     _parent   parent folder path (`""` for root)
 *     _extension  on-server file extension (files only)
 *     _content  the serialized object content (files only)
 *
 * Listing a folder is one Algolia query against `_parent:"<folder>"`. Finding
 * an extension-free key issues one `GET` per registered extension in parallel
 * — bounded by the serializer registry size, typically 1–4.
 *
 * The interesting consequence of using Algolia for storage rather than a
 * blob store: every record you write becomes **immediately searchable**. The
 * storage contract doesn't expose search semantics yet, but everything
 * `createObject` puts in the registered serializer's serialized form lands in
 * Algolia's inverted index alongside the reserved attributes — so a sibling
 * "search" surface can be layered on without re-indexing.
 */
export class AlgoliaStorageRepository extends StorageRepository {
  private readonly dataSource: AlgoliaDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: AlgoliaStorageRepositoryOptions) {
    super();
    this.dataSource = new AlgoliaDataSource(options);
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

  private async deserialize(extension: string, raw: unknown): Promise<StorageObjectContent> {
    const ext = extension.startsWith('.') ? extension.slice(1) : extension;
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${this.availableExtensions.join(', ')}`,
      );
    }
    // `raw` is stored as a string in `_content`. When the upstream serializer
    // is the `json` serializer this is a stringified object; for `md` it's
    // the raw markdown body.
    return serializer.deserializeDocumentFileContents(String(raw ?? ''), {});
  }

  private objectIdFor(key: string, extension: string | undefined, type: 'file' | 'folder'): string {
    const k = trimSlashes(key);
    if (type === 'folder' || !extension) return k;
    return `${k}.${extension}`;
  }

  /** Pull a key + extension off an Algolia record, stripping the registered extension. */
  private keyAndExtension(record: AlgoliaRecord): { key: string, extension: string | undefined } {
    const objectID = record.objectID;
    const extension = record[EXTENSION_ATTR];
    if (typeof extension === 'string' && objectID.endsWith(`.${extension}`)) {
      return { key: objectID.slice(0, -(extension.length + 1)), extension };
    }
    return { key: objectID, extension: undefined };
  }

  /**
   * Probe each registered extension for an extension-free key with a parallel
   * batch of GETs. Returns the first hit whose `_type` is `file`.
   */
  private async findExistingFile(key: string): Promise<LaikaResult<AlgoliaRecord | null>> {
    const trimmed = trimSlashes(key);
    const probes = await Promise.all(
      this.availableExtensions.map(ext => this.dataSource.getRecord(`${trimmed}.${ext}`)),
    );
    for (const probe of probes) {
      if (Result.isFailure(probe)) return Result.fail(probe.failure);
      const record = probe.success;
      if (record && record[TYPE_ATTR] === 'file') return Result.succeed(record);
    }
    return Result.succeed(null);
  }

  // -----------------------------------------------------------------------
  // StorageRepository implementation
  // -----------------------------------------------------------------------

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const record = yield* liftResult(this.findExistingFile(key));
        if (!record) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const extension = String(record[EXTENSION_ATTR] ?? '');
        const content = yield* Effect.promise(() => this.deserialize(extension, record[CONTENT_ATTR]));
        const { key: bareKey } = this.keyAndExtension(record);
        return {
          type: 'object',
          key: bareKey,
          createdAt: typeof record._createdAt === 'string' ? record._createdAt : undefined,
          updatedAt: typeof record._updatedAt === 'string' ? record._updatedAt : undefined,
          content,
          metadata: { extension, revisionId: record.objectID },
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
        const record = yield* liftResult(this.dataSource.getRecord(trimmed));
        if (!record || record[TYPE_ATTR] !== 'folder') {
          return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        }
        return {
          type: 'folder',
          key: trimmed,
          createdAt: typeof record._createdAt === 'string' ? record._createdAt : undefined,
          updatedAt: typeof record._updatedAt === 'string' ? record._updatedAt : undefined,
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
        const direct = yield* liftResult(this.dataSource.getRecord(trimmed));
        if (direct?.[TYPE_ATTR] === 'folder') {
          return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
        }
        return yield* LaikaTask.runValue(this.getObject(key)) as Effect.Effect<Atom, LaikaError>;
      })
    );
  }

  /** Ensure folder marker records exist for every ancestor of `folderKey`. */
  private async ensureFolderChain(folderKey: string): Promise<LaikaResult<void>> {
    const trimmed = trimSlashes(folderKey);
    if (trimmed === '') return Result.succeed(undefined);
    const segments = trimmed.split('/');
    for (let i = 0; i < segments.length; i++) {
      const parent = segments.slice(0, i).join('/');
      const objectID = segments.slice(0, i + 1).join('/');
      const existing = await this.dataSource.getRecord(objectID);
      if (Result.isFailure(existing)) return Result.fail(existing.failure);
      if (existing.success?.[TYPE_ATTR] === 'folder') continue;
      const now = new Date().toISOString();
      const put = await this.dataSource.putRecord({
        objectID,
        [TYPE_ATTR]: 'folder',
        [PARENT_ATTR]: parent,
        _createdAt: now,
        _updatedAt: now,
      });
      if (Result.isFailure(put)) return Result.fail(put.failure);
    }
    return Result.succeed(undefined);
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
              `An object with key "${create.key}" already exists with extension .${existing[EXTENSION_ATTR]}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const { parent } = splitKey(create.key);
        if (parent !== '') yield* liftResult(this.ensureFolderChain(parent));
        const now = new Date().toISOString();
        const objectID = this.objectIdFor(create.key, extension, 'file');
        yield* liftResult(this.dataSource.putRecord({
          objectID,
          [TYPE_ATTR]: 'file',
          [PARENT_ATTR]: parent,
          [EXTENSION_ATTR]: extension,
          [CONTENT_ATTR]: serialized,
          _createdAt: now,
          _updatedAt: now,
        }));
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
          const extension = String(existing[EXTENSION_ATTR] ?? this.defaultFileExtension);
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          yield* liftResult(this.dataSource.putRecord({
            ...existing,
            [CONTENT_ATTR]: serialized,
            _updatedAt: new Date().toISOString(),
          }));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.findExistingFile(create.key));
        const extension = existing
          ? String(existing[EXTENSION_ATTR] ?? this.defaultFileExtension)
          : this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const { parent } = splitKey(create.key);
        if (parent !== '') yield* liftResult(this.ensureFolderChain(parent));
        const now = new Date().toISOString();
        const objectID = this.objectIdFor(create.key, extension, 'file');
        const createdAt = existing && typeof existing._createdAt === 'string'
          ? existing._createdAt
          : now;
        yield* liftResult(this.dataSource.putRecord({
          objectID,
          [TYPE_ATTR]: 'file',
          [PARENT_ATTR]: parent,
          [EXTENSION_ATTR]: extension,
          [CONTENT_ATTR]: serialized,
          _createdAt: createdAt,
          _updatedAt: now,
        }));
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

          // Folder marker?
          const direct = yield* Effect.result(liftResult(this.dataSource.getRecord(trimmed)));
          if (Result.isFailure(direct)) {
            yield* emit.recoverableError(direct.failure);
            skipped += 1;
            continue;
          }
          if (direct.success?.[TYPE_ATTR] === 'folder') {
            const children = yield* Effect.result(liftResult(this.dataSource.queryByParent(trimmed)));
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
            const deleted = yield* Effect.result(liftResult(this.dataSource.deleteRecord(trimmed)));
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
          const deleted = yield* Effect.result(liftResult(this.dataSource.deleteRecord(file.success.objectID)));
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

      // Confirm the parent folder exists when it isn't the root.
      if (trimmed !== '') {
        const parentRecord = yield* liftResult(this.dataSource.getRecord(trimmed));
        if (!parentRecord || parentRecord[TYPE_ATTR] !== 'folder') {
          return {
            summaries: [] as ReadonlyArray<AtomSummary>,
            missingFolder: new NotFoundError(`No folder found at key "${folderKey}"`),
          };
        }
      }

      const children = yield* liftResult(this.dataSource.queryByParent(trimmed));
      const summaries: AtomSummary[] = children.map(record => {
        if (record[TYPE_ATTR] === 'folder') {
          return { type: 'folder-summary', key: record.objectID };
        }
        const { key } = this.keyAndExtension(record);
        return { type: 'object-summary', key };
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
        description: 'Stores each object as an Algolia record whose `objectID` is `<key>.<ext>`.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over `_parent:"<folder>"` queries; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
