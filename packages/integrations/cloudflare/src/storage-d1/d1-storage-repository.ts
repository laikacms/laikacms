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

import { D1DataSource, type D1DataSourceOptions, type D1Row } from './d1-datasource.js';

export const DEFAULT_TABLE_NAME = 'laika_storage';

export interface D1StorageRepositoryOptions extends D1DataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  /** Table name; defaults to `laika_storage`. */
  readonly tableName?: string;
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

/**
 * The SQL DDL the repository needs. Exported so callers can wire this into
 * their D1 migration setup (Wrangler, drizzle-kit, raw `wrangler d1 execute
 * --file=schema.sql`, etc.). The repository never runs DDL on its own — it
 * assumes the table already exists.
 *
 * Returns a single CREATE TABLE statement (no trailing semicolon).
 */
export const schemaDdl = (tableName = DEFAULT_TABLE_NAME): string =>
  `
CREATE TABLE IF NOT EXISTS "${tableName}" (
  parent_key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('file', 'folder')),
  extension TEXT,
  content TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  etag TEXT NOT NULL,
  PRIMARY KEY (parent_key, name)
)`.trim();

interface StorageRow {
  parent_key: string;
  name: string;
  type: 'file' | 'folder';
  extension: string | null;
  content: string | null;
  created_at: string;
  updated_at: string;
  etag: string;
}

const rowToStorageRow = (row: D1Row): StorageRow => ({
  parent_key: String(row.parent_key ?? ''),
  name: String(row.name ?? ''),
  type: (row.type === 'folder' ? 'folder' : 'file'),
  extension: row.extension === null || row.extension === undefined ? null : String(row.extension),
  content: row.content === null || row.content === undefined ? null : String(row.content),
  created_at: String(row.created_at ?? new Date(0).toISOString()),
  updated_at: String(row.updated_at ?? new Date(0).toISOString()),
  etag: String(row.etag ?? ''),
});

const newEtag = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * A {@link StorageRepository} backed by Cloudflare D1 (a managed SQLite
 * database) over its HTTP REST API. Edge-friendly: D1 returns query results
 * over plain HTTP, so this implementation runs on Node, Bun, Deno, Workers,
 * and the browser — no SQLite driver required.
 *
 * Schema (one table per repository instance, configurable name):
 *
 *     parent_key TEXT NOT NULL    folder path of the entry's parent
 *     name       TEXT NOT NULL    basename — includes the extension for files
 *     type       TEXT NOT NULL    'file' | 'folder'
 *     extension  TEXT             files only
 *     content    TEXT             serialized content, files only
 *     created_at TEXT NOT NULL    ISO timestamp
 *     updated_at TEXT NOT NULL    ISO timestamp
 *     etag       TEXT NOT NULL    opaque per-write tag — exposed as `metadata.revisionId`
 *     PRIMARY KEY (parent_key, name)
 *
 * Listing a folder is one indexed `SELECT * WHERE parent_key = ?`. Finding
 * an extension-free key is one `SELECT … WHERE parent_key = ? AND name LIKE
 * ?` — the SQL `LIKE` plus a client-side filter to the registered
 * serializer extensions does both lookups in a single round-trip, in
 * contrast to the parallel-`EXISTS` probe other backends use.
 *
 * The repository never runs DDL — call {@link schemaDdl} once at deploy
 * time to provision the table.
 */
export class D1StorageRepository extends StorageRepository {
  private readonly dataSource: D1DataSource;
  private readonly tableName: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: D1StorageRepositoryOptions) {
    super();
    this.dataSource = new D1DataSource(options);
    // Aggressively reject anything that could break the SQL — D1 doesn't
    // accept identifiers as bound parameters, so the table name has to be
    // interpolated. Limit to a safe character set.
    const tableName = options.tableName ?? DEFAULT_TABLE_NAME;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
      throw new BadRequestError(
        `D1StorageRepository tableName must match /^[A-Za-z_][A-Za-z0-9_]*$/; got "${tableName}"`,
      );
    }
    this.tableName = tableName;
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

  private async getRow(parentKey: string, name: string): Promise<LaikaResult<StorageRow | null>> {
    const rows = await this.dataSource.query<D1Row>(
      `SELECT * FROM "${this.tableName}" WHERE parent_key = ? AND name = ?`,
      [parentKey, name],
    );
    if (Result.isFailure(rows)) return Result.fail(rows.failure);
    const row = rows.success[0];
    return Result.succeed(row ? rowToStorageRow(row) : null);
  }

  /**
   * Find a file by extension-free key — one indexed `SELECT … WHERE
   * parent_key = ? AND name LIKE ?` plus a client-side filter to the
   * registered serializer extensions. Single round-trip regardless of the
   * registry size.
   */
  private async findExistingFile(key: string): Promise<LaikaResult<StorageRow | null>> {
    const { parent, name } = splitKey(key);
    if (name === '') return Result.succeed(null);
    const rows = await this.dataSource.query<D1Row>(
      `SELECT * FROM "${this.tableName}" WHERE parent_key = ? AND name LIKE ?`,
      [parent, `${name}.%`],
    );
    if (Result.isFailure(rows)) return Result.fail(rows.failure);
    for (const raw of rows.success) {
      const row = rowToStorageRow(raw);
      if (row.type !== 'file') continue;
      const ext = row.extension ?? '';
      if (ext && this.availableExtensions.includes(ext) && row.name === `${name}.${ext}`) {
        return Result.succeed(row);
      }
    }
    return Result.succeed(null);
  }

  private async upsertRow(row: StorageRow): Promise<LaikaResult<void>> {
    const exec = await this.dataSource.execute(
      `INSERT OR REPLACE INTO "${this.tableName}" `
        + `(parent_key, name, type, extension, content, created_at, updated_at, etag) `
        + `VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.parent_key, row.name, row.type, row.extension, row.content, row.created_at, row.updated_at, row.etag],
    );
    if (Result.isFailure(exec)) return Result.fail(exec.failure);
    return Result.succeed(undefined);
  }

  private async deleteRow(parentKey: string, name: string): Promise<LaikaResult<void>> {
    const exec = await this.dataSource.execute(
      `DELETE FROM "${this.tableName}" WHERE parent_key = ? AND name = ?`,
      [parentKey, name],
    );
    if (Result.isFailure(exec)) return Result.fail(exec.failure);
    return Result.succeed(undefined);
  }

  private async ensureFolderChain(folderKey: string): Promise<LaikaResult<void>> {
    const trimmed = trimSlashes(folderKey);
    if (trimmed === '') return Result.succeed(undefined);
    const segments = trimmed.split('/');
    for (let i = 0; i < segments.length; i++) {
      const parent = segments.slice(0, i).join('/');
      const name = segments[i];
      const existing = await this.getRow(parent, name);
      if (Result.isFailure(existing)) return Result.fail(existing.failure);
      if (existing.success?.type === 'folder') continue;
      const now = new Date().toISOString();
      const put = await this.upsertRow({
        parent_key: parent,
        name,
        type: 'folder',
        extension: null,
        content: null,
        created_at: existing.success?.created_at ?? now,
        updated_at: now,
        etag: newEtag(),
      });
      if (Result.isFailure(put)) return Result.fail(put.failure);
    }
    return Result.succeed(undefined);
  }

  // -----------------------------------------------------------------------
  // StorageRepository implementation
  // -----------------------------------------------------------------------

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const row = yield* liftResult(this.findExistingFile(key));
        if (!row || !row.extension || row.content === null) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const content = yield* Effect.promise(() => this.deserialize(row.extension!, row.content!));
        return {
          type: 'object',
          key: trimSlashes(key),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          content,
          metadata: { extension: row.extension, revisionId: row.etag },
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
        const row = yield* liftResult(this.getRow(parent, name));
        if (!row || row.type !== 'folder') {
          return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        }
        return {
          type: 'folder',
          key: trimmed,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
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
        const direct = yield* liftResult(this.getRow(parent, name));
        if (direct?.type === 'folder') {
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
        const now = new Date().toISOString();
        yield* liftResult(this.upsertRow({
          parent_key: parent,
          name: `${name}.${extension}`,
          type: 'file',
          extension,
          content: serialized,
          created_at: now,
          updated_at: now,
          etag: newEtag(),
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
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension!, update.content!));
          yield* liftResult(this.upsertRow({
            ...existing,
            content: serialized,
            updated_at: new Date().toISOString(),
            etag: newEtag(),
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
          const { parent, name } = splitKey(trimmed);

          const direct = yield* Effect.result(liftResult(this.getRow(parent, name)));
          if (Result.isFailure(direct)) {
            yield* emit.recoverableError(direct.failure);
            skipped += 1;
            continue;
          }

          // Folder marker?
          if (direct.success?.type === 'folder') {
            const childRows = yield* Effect.result(liftResult(this.dataSource.query<D1Row>(
              `SELECT 1 FROM "${this.tableName}" WHERE parent_key = ? LIMIT 1`,
              [trimmed],
            )));
            if (Result.isFailure(childRows)) {
              yield* emit.recoverableError(childRows.failure);
              skipped += 1;
              continue;
            }
            if (childRows.success.length > 0) {
              yield* emit.recoverableError(new ForbiddenError(`Refusing to delete non-empty folder "${key}"`));
              skipped += 1;
              continue;
            }
            const deleted = yield* Effect.result(liftResult(this.deleteRow(parent, name)));
            if (Result.isFailure(deleted)) {
              yield* emit.recoverableError(deleted.failure);
              skipped += 1;
            } else {
              yield* emit.data(trimmed);
              removed += 1;
            }
            continue;
          }

          // Otherwise resolve as a file row with extension.
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
          const deleted = yield* Effect.result(
            liftResult(this.deleteRow(file.success.parent_key, file.success.name)),
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

      // Confirm the folder exists (root is implicit).
      if (trimmed !== '') {
        const { parent, name } = splitKey(trimmed);
        const folderRow = yield* liftResult(this.getRow(parent, name));
        if (!folderRow || folderRow.type !== 'folder') {
          return {
            summaries: [] as ReadonlyArray<AtomSummary>,
            missingFolder: new NotFoundError(`No folder found at key "${folderKey}"`),
          };
        }
      }

      const rows = yield* liftResult(this.dataSource.query<D1Row>(
        `SELECT * FROM "${this.tableName}" WHERE parent_key = ?`,
        [trimmed],
      ));
      const summaries: AtomSummary[] = rows.map((raw): AtomSummary => {
        const row = rowToStorageRow(raw);
        const fullKey = trimmed === '' ? row.name : `${trimmed}/${row.name}`;
        if (row.type === 'folder') return { type: 'folder-summary', key: fullKey };
        const ext = row.extension ?? '';
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
        description: 'Stores each object as a SQLite row keyed by (parent_key, name); name carries the extension.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over `SELECT … WHERE parent_key = ?`; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
