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
  escapePbFilterValue,
  PocketBaseDataSource,
  type PocketBaseDataSourceOptions,
  type PocketBaseRecord,
} from './pocketbase-datasource.js';

export interface PocketBaseStorageRepositoryOptions extends PocketBaseDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitKey = (key: string): { parent: string, name: string } => {
  const k = trimSlashes(key);
  const idx = k.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: k } : { parent: k.slice(0, idx), name: k.slice(idx + 1) };
};

const TYPE_FILE = 'file';
const TYPE_FOLDER = 'folder';

/**
 * A {@link StorageRepository} backed by [PocketBase](https://pocketbase.io) —
 * the first self-hostable, open-source backend in the suite. Every other
 * backend so far is a SaaS endpoint, a hyperscaler service, or a network
 * protocol; PocketBase is a single binary you run yourself, SQLite under
 * the hood, REST + JWT on the wire.
 *
 * Each storage entry is one PocketBase record in a configured collection
 * (defaults to `laika_storage`):
 *
 *     parent      parent folder path
 *     name        basename — includes the extension for files
 *     path        full storage key (indexed for fast lookups)
 *     type        'file' | 'folder'
 *     extension   on-server file extension                    (files only)
 *     content     serialized object content                   (files only)
 *
 * Listing a folder is one filtered list: `filter=parent="folder/path"`.
 * Finding an extension-free key uses PocketBase's `||` to disjunct N
 * candidate names — `filter=parent="..." && (name="k.json" || name="k.md")`
 * — so the registered serializer extensions get checked in one round-trip.
 *
 * Required collection schema (provision once via the PocketBase admin UI
 * or `pb migrate`):
 *
 *     parent     TEXT
 *     name       TEXT  (indexed, not unique on its own; pair with parent)
 *     path       TEXT  (indexed, unique)
 *     type       SELECT  values: file, folder
 *     extension  TEXT
 *     content    TEXT
 *
 * Runtime-agnostic — only depends on `fetch`. Caller owns JWT refresh via
 * `auth.tokenProvider`.
 */
export class PocketBaseStorageRepository extends StorageRepository {
  private readonly dataSource: PocketBaseDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: PocketBaseStorageRepositoryOptions) {
    super();
    this.dataSource = new PocketBaseDataSource(options);
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

  /**
   * Resolve an extension-free key to its on-PB record in one round-trip:
   * `filter=parent="..." && (name="k.json" || name="k.md" || ...)`.
   * Returns `null` when nothing matches.
   */
  private async findExistingFile(key: string): Promise<LaikaResult<PocketBaseRecord | null>> {
    const { parent, name } = splitKey(key);
    if (name === '') return Result.succeed(null);
    const nameClause = this.availableExtensions
      .map(ext => `name = ${escapePbFilterValue(`${name}.${ext}`)}`)
      .join(' || ');
    const filter = `type = ${escapePbFilterValue(TYPE_FILE)} && parent = ${
      escapePbFilterValue(parent)
    } && (${nameClause})`;
    const hit = await this.dataSource.findOne(filter);
    if (Result.isFailure(hit)) return Result.fail(hit.failure);
    return Result.succeed(hit.success);
  }

  private async ensureFolderChain(folderKey: string): Promise<LaikaResult<void>> {
    const trimmed = trimSlashes(folderKey);
    if (trimmed === '') return Result.succeed(undefined);
    const segments = trimmed.split('/');
    for (let i = 0; i < segments.length; i++) {
      const ancestorParent = segments.slice(0, i).join('/');
      const ancestorName = segments[i];
      const ancestorPath = segments.slice(0, i + 1).join('/');
      const existing = await this.dataSource.findOne(
        `path = ${escapePbFilterValue(ancestorPath)}`,
      );
      if (Result.isFailure(existing)) return Result.fail(existing.failure);
      if (existing.success?.type === TYPE_FOLDER) continue;
      const created = await this.dataSource.create({
        parent: ancestorParent,
        name: ancestorName,
        path: ancestorPath,
        type: TYPE_FOLDER,
      });
      if (Result.isFailure(created)) return Result.fail(created.failure);
    }
    return Result.succeed(undefined);
  }

  // -----------------------------------------------------------------------
  // StorageRepository implementation
  // -----------------------------------------------------------------------

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const found = yield* liftResult(this.findExistingFile(key));
        if (!found) return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        const extension = String(found.extension ?? '');
        const content = yield* Effect.promise(() => this.deserialize(extension, String(found.content ?? '')));
        return {
          type: 'object',
          key: trimSlashes(key),
          createdAt: typeof found.created === 'string' ? found.created : undefined,
          updatedAt: typeof found.updated === 'string' ? found.updated : undefined,
          content,
          metadata: { extension, revisionId: typeof found.updated === 'string' ? found.updated : undefined },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '') return { type: 'folder', key: '' } satisfies Folder;
        const found = yield* liftResult(this.dataSource.findOne(
          `type = ${escapePbFilterValue(TYPE_FOLDER)} && path = ${escapePbFilterValue(trimmed)}`,
        ));
        if (!found) return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        return {
          type: 'folder',
          key: trimmed,
          createdAt: typeof found.created === 'string' ? found.created : undefined,
          updatedAt: typeof found.updated === 'string' ? found.updated : undefined,
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
        const direct = yield* liftResult(this.dataSource.findOne(
          `path = ${escapePbFilterValue(trimmed)}`,
        ));
        if (direct?.type === TYPE_FOLDER) {
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
        if (parent !== '') yield* liftResult(this.ensureFolderChain(parent));
        yield* liftResult(this.dataSource.create({
          parent,
          name: `${name}.${extension}`,
          path: trimSlashes(create.key),
          type: TYPE_FILE,
          extension,
          content: serialized,
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
          const extension = String(existing.extension ?? this.defaultFileExtension);
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          yield* liftResult(this.dataSource.patch(existing.id, { content: serialized }));
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
          if (trimmed === '') {
            yield* emit.recoverableError(new ForbiddenError('Refusing to delete the storage root'));
            skipped += 1;
            continue;
          }

          const direct = yield* Effect.result(liftResult(this.dataSource.findOne(
            `path = ${escapePbFilterValue(trimmed)}`,
          )));
          if (Result.isFailure(direct)) {
            yield* emit.recoverableError(direct.failure);
            skipped += 1;
            continue;
          }

          if (direct.success?.type === TYPE_FOLDER) {
            const children = yield* Effect.result(liftResult(this.dataSource.list(
              `parent = ${escapePbFilterValue(trimmed)}`,
              { perPage: 1 },
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
            const deleted = yield* Effect.result(liftResult(this.dataSource.delete(direct.success.id)));
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
          const deleted = yield* Effect.result(liftResult(this.dataSource.delete(file.success.id)));
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

      if (trimmed !== '') {
        const folder = yield* liftResult(this.dataSource.findOne(
          `type = ${escapePbFilterValue(TYPE_FOLDER)} && path = ${escapePbFilterValue(trimmed)}`,
        ));
        if (!folder) {
          return {
            summaries: [] as ReadonlyArray<AtomSummary>,
            missingFolder: new NotFoundError(`No folder found at key "${folderKey}"`),
          };
        }
      }

      const children = yield* liftResult(this.dataSource.list(
        `parent = ${escapePbFilterValue(trimmed)}`,
      ));
      const summaries: AtomSummary[] = children.map((row): AtomSummary => {
        const name = String(row.name ?? '');
        const fullKey = trimmed === '' ? name : `${trimmed}/${name}`;
        if (row.type === TYPE_FOLDER) {
          return { type: 'folder-summary', key: fullKey };
        }
        const ext = typeof row.extension === 'string' ? row.extension : '';
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
        description: 'Stores each object as a PocketBase record with the on-server name carrying the extension.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description:
          'In-memory slicing over PocketBase\'s `filter=parent="..."` list calls; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
