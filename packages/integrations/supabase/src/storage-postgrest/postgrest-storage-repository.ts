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

import { PostgrestDataSource, type PostgrestDataSourceOptions } from './postgrest-datasource.js';

export interface PostgrestStorageRepositoryOptions extends PostgrestDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

interface StorageRow {
  id?: string;
  parent: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  extension?: string;
  content?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
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
 * A {@link StorageRepository} backed by a Supabase / PostgREST table.
 * Postgres-over-HTTP for the price of a single fetch dependency — runs
 * on Node, Bun, Deno, Cloudflare Workers, Vercel Edge, the browser.
 *
 * Required table schema (provision once via Supabase Studio or `psql`):
 *
 *     parent       text not null
 *     name         text not null
 *     path         text not null unique
 *     type         text not null check (type in ('file','folder'))
 *     extension    text
 *     content      text
 *     created_at   timestamptz default now()
 *     updated_at   timestamptz default now()
 *
 * The repository assumes the table is provisioned and never runs DDL —
 * same model as the Cloudflare D1 / PocketBase / Airtable iterations.
 *
 * **The interesting bit is the query DSL.** Every backend in the loop has
 * used a different filter language: GROQ, GraphQL, SQL, Algolia filters,
 * PocketBase filters, Airtable formulas, IPFS metadata operators. Supabase
 * uses **PostgREST**: operator-suffix URL parameters like
 * `?Parent=eq.notes&Type=eq.file` and OR groups via
 * `?or=(Name.eq.x,Name.eq.y)`. The data source emits these for the exact
 * shapes the repository needs.
 */
export class PostgrestStorageRepository extends StorageRepository {
  private readonly dataSource: PostgrestDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: PostgrestStorageRepositoryOptions) {
    super();
    this.dataSource = new PostgrestDataSource(options);
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
   * Find an extension-free file with **one PostgREST request**. The
   * registered extensions are joined into a single `or=(Name.eq.k.ext1,
   * Name.eq.k.ext2, …)` clause.
   */
  private async findExistingFile(key: string): Promise<LaikaResult<StorageRow | null>> {
    const { parent, name } = splitKey(key);
    if (name === '') return Result.succeed(null);
    // `URLSearchParams` (used downstream) handles URL encoding — don't
    // pre-encode here or values containing slashes/dots get doubly mangled.
    const orClause = this.availableExtensions
      .map(ext => `Name.eq.${name}.${ext}`)
      .join(',');
    const rows = await this.dataSource.list<StorageRow>(
      [
        { column: 'Type', operator: 'eq', value: TYPE_FILE },
        { column: 'Parent', operator: 'eq', value: parent },
      ],
      { or: orClause, limit: 1 },
    );
    if (Result.isFailure(rows)) return Result.fail(rows.failure);
    return Result.succeed(rows.success[0] ?? null);
  }

  private async findFolder(path: string): Promise<LaikaResult<StorageRow | null>> {
    const trimmed = trimSlashes(path);
    if (trimmed === '') return Result.succeed(null);
    const rows = await this.dataSource.list<StorageRow>([
      { column: 'Type', operator: 'eq', value: TYPE_FOLDER },
      { column: 'Path', operator: 'eq', value: trimmed },
    ], { limit: 1 });
    if (Result.isFailure(rows)) return Result.fail(rows.failure);
    return Result.succeed(rows.success[0] ?? null);
  }

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
      const inserted = await this.dataSource.insert<StorageRow>([{
        Parent: ancestorParent,
        Name: ancestorName,
        Path: ancestorPath,
        Type: TYPE_FOLDER,
      } as unknown as StorageRow]);
      if (Result.isFailure(inserted)) return Result.fail(inserted.failure);
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
        const extension = String((found as Record<string, unknown>)['Extension'] ?? '');
        const rawContent = String((found as Record<string, unknown>)['Content'] ?? '');
        const content = yield* Effect.promise(() => this.deserialize(extension, rawContent));
        const createdAt = (found as Record<string, unknown>)['created_at'] as string | undefined;
        const updatedAt = (found as Record<string, unknown>)['updated_at'] as string | undefined;
        return {
          type: 'object',
          key: trimSlashes(key),
          createdAt,
          updatedAt,
          content,
          metadata: { extension, revisionId: updatedAt },
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
        const createdAt = (found as Record<string, unknown>)['created_at'] as string | undefined;
        const updatedAt = (found as Record<string, unknown>)['updated_at'] as string | undefined;
        return { type: 'folder', key: trimmed, createdAt, updatedAt } satisfies Folder;
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
              `An object with key "${create.key}" already exists with extension .${
                (existing as Record<string, unknown>)['Extension']
              }`,
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

        yield* liftResult(this.dataSource.insert<StorageRow>([{
          Parent: parent,
          Name: `${name}.${extension}`,
          Path: trimSlashes(create.key),
          Type: TYPE_FILE,
          Extension: extension,
          Content: serialized,
        } as unknown as StorageRow]));
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
          const extension = String((existing as Record<string, unknown>)['Extension'] ?? this.defaultFileExtension);
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          // PATCH ?Path=eq.<trimmed>  body {Content: ..., updated_at: now}
          yield* liftResult(this.dataSource.update<StorageRow>(
            [{ column: 'Path', operator: 'eq', value: trimSlashes(update.key) }],
            { Content: serialized, updated_at: new Date().toISOString() } as unknown as Partial<StorageRow>,
          ));
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

        // Resolve every key to a path (file or folder). Bucket the result
        // into one big `Path=in.(…)` DELETE — PostgREST happily takes a
        // comma-separated list.
        const pathsToDelete: string[] = [];
        const trimmedByPath = new Map<string, string>();
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
            const children = yield* Effect.result(liftResult(this.dataSource.list<StorageRow>(
              [{ column: 'Parent', operator: 'eq', value: trimmed }],
              { limit: 1 },
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
            pathsToDelete.push(trimmed);
            trimmedByPath.set(trimmed, trimmed);
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
          const path = String((file.success as Record<string, unknown>)['Path'] ?? '');
          pathsToDelete.push(path);
          trimmedByPath.set(path, trimmed);
        }

        if (pathsToDelete.length === 0) return { removed, skipped };

        // PostgREST's `in.(...)` accepts a comma-separated list. Quote
        // values that contain commas / parens / leading whitespace.
        const inList = pathsToDelete.map(p => `"${p.replace(/"/g, '\\"')}"`).join(',');
        const deleted = yield* Effect.result(liftResult(this.dataSource.delete<StorageRow>([
          { column: 'Path', operator: 'in', value: `(${inList})` },
        ])));
        if (Result.isFailure(deleted)) {
          for (const _ of pathsToDelete) {
            yield* emit.recoverableError(deleted.failure);
            skipped += 1;
          }
          return { removed, skipped };
        }
        for (const path of pathsToDelete) {
          const trimmed = trimmedByPath.get(path) ?? path;
          yield* emit.data(trimmed);
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
      const rows = yield* liftResult(this.dataSource.list<StorageRow>([
        { column: 'Parent', operator: 'eq', value: trimmed },
      ]));
      const summaries: AtomSummary[] = rows.map((row): AtomSummary => {
        const fields = row as Record<string, unknown>;
        const name = String(fields['Name'] ?? '');
        const path = String(fields['Path'] ?? '');
        const type = String(fields['Type'] ?? '');
        if (type === TYPE_FOLDER) return { type: 'folder-summary', key: path };
        const ext = String(fields['Extension'] ?? '');
        const fullKey = trimmed === '' ? name : `${trimmed}/${name}`;
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
        description: 'Stores each object as a row in a Supabase Postgres table accessed via PostgREST.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description:
          'In-memory slicing over PostgREST `?Parent=eq.<folder>` queries; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
