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
  AirtableDataSource,
  type AirtableDataSourceOptions,
  type AirtableRecord,
  escapeAirtableString,
} from './airtable-datasource.js';

export interface AirtableStorageRepositoryOptions extends AirtableDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

interface StorageFields {
  readonly Parent: string;
  readonly Name: string;
  readonly Path: string;
  readonly Type: 'file' | 'folder';
  readonly Extension?: string;
  readonly Content?: string;
  // Index signature so this satisfies `Record<string, unknown>` — required
  // by the generic constraint on `AirtableRecord<F>`.
  readonly [key: string]: unknown;
}

const TYPE_FILE = 'file';
const TYPE_FOLDER = 'folder';

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitKey = (key: string): { parent: string, name: string } => {
  const k = trimSlashes(key);
  const idx = k.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: k } : { parent: k.slice(0, idx), name: k.slice(idx + 1) };
};

/**
 * A {@link StorageRepository} backed by an Airtable table.
 *
 * Each storage entry is one Airtable record. The table must carry the
 * documented schema (provision once via the Airtable UI):
 *
 *     Parent     — Single line text
 *     Name       — Single line text
 *     Path       — Single line text  (unique-ish; the repository's primary lookup)
 *     Type       — Single select     values: file, folder
 *     Extension  — Single line text  (files only)
 *     Content    — Long text         (files only)
 *
 * Two Airtable quirks the repository handles invisibly:
 *
 * - **`filterByFormula` is Airtable's own DSL** — fields in `{Braces}`,
 *   string literals double-quoted with embedded `"` doubled.
 *   {@link escapeAirtableString} keeps user input safe in the formula.
 * - **Batch endpoints cap at 10 records** per call. The data source chunks
 *   bigger batches automatically, so `removeAtoms(50_keys)` quietly fires
 *   the minimum 5 + N HTTP calls instead of one big batch the server would
 *   reject.
 *
 * `metadata.revisionId` carries the `createdTime` timestamp — Airtable
 * doesn't expose a monotonic version field, so OCC isn't enforced.
 */
export class AirtableStorageRepository extends StorageRepository {
  private readonly dataSource: AirtableDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: AirtableStorageRepositoryOptions) {
    super();
    this.dataSource = new AirtableDataSource(options);
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
   * Find an extension-free file with one `filterByFormula` call that
   * `OR`s every registered extension. Single round-trip regardless of
   * how many serializers are registered — Algolia / D1 / Sanity all use
   * the same trick with their own languages.
   */
  private async findExistingFile(key: string): Promise<LaikaResult<AirtableRecord<StorageFields> | null>> {
    const { parent, name } = splitKey(key);
    if (name === '') return Result.succeed(null);
    const nameClause = this.availableExtensions
      .map(ext => `{Name} = ${escapeAirtableString(`${name}.${ext}`)}`)
      .join(', ');
    const formula = `AND({Type} = ${escapeAirtableString(TYPE_FILE)}, {Parent} = ${
      escapeAirtableString(parent)
    }, OR(${nameClause}))`;
    const rows = await this.dataSource.list<StorageFields>(formula, { pageSize: 1 });
    if (Result.isFailure(rows)) return Result.fail(rows.failure);
    return Result.succeed(rows.success[0] ?? null);
  }

  private async findFolder(path: string): Promise<LaikaResult<AirtableRecord<StorageFields> | null>> {
    const trimmed = trimSlashes(path);
    if (trimmed === '') return Result.succeed(null);
    const formula = `AND({Type} = ${escapeAirtableString(TYPE_FOLDER)}, {Path} = ${escapeAirtableString(trimmed)})`;
    const rows = await this.dataSource.list<StorageFields>(formula, { pageSize: 1 });
    if (Result.isFailure(rows)) return Result.fail(rows.failure);
    return Result.succeed(rows.success[0] ?? null);
  }

  /** Idempotently create folder records for every ancestor of `folderKey`. */
  private async ensureFolderChain(folderKey: string): Promise<LaikaResult<void>> {
    const trimmed = trimSlashes(folderKey);
    if (trimmed === '') return Result.succeed(undefined);
    const segments = trimmed.split('/');
    for (let i = 0; i < segments.length; i++) {
      const ancestorParent = segments.slice(0, i).join('/');
      const ancestorName = segments[i];
      const ancestorPath = segments.slice(0, i + 1).join('/');
      const existing = await this.findFolder(ancestorPath);
      if (Result.isFailure(existing)) return Result.fail(existing.failure);
      if (existing.success) continue;
      const created = await this.dataSource.create<StorageFields>([{
        fields: {
          Parent: ancestorParent,
          Name: ancestorName,
          Path: ancestorPath,
          Type: TYPE_FOLDER,
        },
      }]);
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
        const extension = String(found.fields.Extension ?? '');
        const content = yield* Effect.promise(() => this.deserialize(extension, String(found.fields.Content ?? '')));
        return {
          type: 'object',
          key: trimSlashes(key),
          createdAt: found.createdTime,
          updatedAt: found.createdTime,
          content,
          metadata: { extension, revisionId: found.createdTime },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '') return { type: 'folder', key: '' } satisfies Folder;
        const found = yield* liftResult(this.findFolder(trimmed));
        if (!found) return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        return {
          type: 'folder',
          key: trimmed,
          createdAt: found.createdTime,
          updatedAt: found.createdTime,
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
        const folder = yield* liftResult(this.findFolder(trimmed));
        if (folder) {
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
              `An object with key "${create.key}" already exists with extension .${existing.fields.Extension}`,
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

        yield* liftResult(this.dataSource.create<StorageFields>([{
          fields: {
            Parent: parent,
            Name: `${name}.${extension}`,
            Path: trimSlashes(create.key),
            Type: TYPE_FILE,
            Extension: extension,
            Content: serialized,
          },
        }]));
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
          const extension = String(existing.fields.Extension ?? this.defaultFileExtension);
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          yield* liftResult(this.dataSource.update<StorageFields>([{
            id: existing.id,
            fields: { Content: serialized },
          }]));
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

        // 1. Resolve every key to a record id (or surface a per-key error).
        //    Then ship one bulk DELETE that the data source chunks at 10
        //    records per HTTP call — `removeAtoms(50)` becomes 5 calls, not 50.
        const resolved: Array<{ key: string, id: string }> = [];
        for (const key of keys) {
          const trimmed = trimSlashes(key);
          if (trimmed === '') {
            yield* emit.recoverableError(new ForbiddenError('Refusing to delete the storage root'));
            skipped += 1;
            continue;
          }
          const folder = yield* Effect.result(liftResult(this.findFolder(trimmed)));
          if (Result.isFailure(folder)) {
            yield* emit.recoverableError(folder.failure);
            skipped += 1;
            continue;
          }
          if (folder.success) {
            const children = yield* Effect.result(liftResult(this.dataSource.list<StorageFields>(
              `{Parent} = ${escapeAirtableString(trimmed)}`,
              { pageSize: 1 },
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
            resolved.push({ key: trimmed, id: folder.success.id });
            continue;
          }
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
          resolved.push({ key: trimmed, id: file.success.id });
        }

        if (resolved.length === 0) return { removed, skipped };

        const ids = resolved.map(r => r.id);
        const deletedResult = yield* Effect.result(liftResult(this.dataSource.delete(ids)));
        if (Result.isFailure(deletedResult)) {
          for (const _ of resolved) {
            yield* emit.recoverableError(deletedResult.failure);
            skipped += 1;
          }
          return { removed, skipped };
        }
        const deletedSet = new Set(deletedResult.success);
        for (const { key, id } of resolved) {
          if (deletedSet.has(id)) {
            yield* emit.data(key);
            removed += 1;
          } else {
            yield* emit.recoverableError(new NotFoundError(`Airtable did not confirm deletion of "${key}"`));
            skipped += 1;
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
        const folder = yield* liftResult(this.findFolder(trimmed));
        if (!folder) {
          return {
            summaries: [] as ReadonlyArray<AtomSummary>,
            missingFolder: new NotFoundError(`No folder found at key "${folderKey}"`),
          };
        }
      }

      const rows = yield* liftResult(this.dataSource.list<StorageFields>(
        `{Parent} = ${escapeAirtableString(trimmed)}`,
      ));
      const summaries: AtomSummary[] = rows.map((row): AtomSummary => {
        const fields = row.fields;
        const fullKey = trimmed === '' ? fields.Name : `${trimmed}/${fields.Name}`;
        if (fields.Type === TYPE_FOLDER) {
          return { type: 'folder-summary', key: fields.Path };
        }
        const ext = fields.Extension ?? '';
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
        description: 'Stores each object as an Airtable record with `Content` as a Long Text field.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over `filterByFormula` results; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
