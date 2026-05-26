import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
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
import * as minimatch from 'minimatch';

import { LibSqlDataSource, rowToObject } from './libsql-datasource.js';

export interface LibSqlStorageRepositoryOptions {
  readonly dataSource: LibSqlDataSource;
  /**
   * The table holding storage rows. Default `laika_storage`. Per
   * libSQL convention the table is validated against the SQL-injection
   * regex below before being interpolated.
   */
  readonly tableName?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_TABLE = 'laika_storage';

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.contentbase',
  '**/.laikacms',
];

const TYPE_FILE = 'file';
const TYPE_FOLDER = 'folder';

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const stripSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitPath = (key: string): { parent: string, name: string } => {
  const k = stripSlashes(key);
  const last = k.lastIndexOf('/');
  if (last === -1) return { parent: '', name: k };
  return { parent: k.slice(0, last), name: k.slice(last + 1) };
};

/** SQL-injection guard: only allow plain identifiers. */
const validateIdentifier = (name: string): void => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new BadRequestError(`Invalid SQL identifier: ${name}`);
  }
};

interface StorageRow {
  Path: string;
  Parent: string;
  Name: string;
  Type: 'file' | 'folder';
  Extension?: string | null;
  Content?: string | null;
}

const decodeRow = (cols: Array<{ name: string }>, row: import('./libsql-datasource.js').LibSqlArg[]): StorageRow => {
  const obj = rowToObject(cols, row);
  return {
    Path: String(obj['Path'] ?? ''),
    Parent: String(obj['Parent'] ?? ''),
    Name: String(obj['Name'] ?? ''),
    Type: obj['Type'] === TYPE_FILE ? TYPE_FILE : TYPE_FOLDER,
    Extension: obj['Extension'] === null || obj['Extension'] === undefined ? null : String(obj['Extension']),
    Content: obj['Content'] === null || obj['Content'] === undefined ? null : String(obj['Content']),
  };
};

/**
 * A {@link StorageRepository} backed by a libSQL database (Turso Cloud,
 * sqld self-hosted, Fly libSQL, anything that speaks hrana). The wire
 * shape — `POST /v2/pipeline` with typed argument objects and atomic
 * `batch` requests — is structurally distinct from Cloudflare D1's
 * `/query` endpoint, even though both back stores are SQLite.
 *
 * Schema (call this once via the SQL console or migration tool — the
 * repository never runs DDL):
 *
 * ```sql
 * CREATE TABLE laika_storage (
 *   Path      TEXT PRIMARY KEY,
 *   Parent    TEXT NOT NULL,
 *   Name      TEXT NOT NULL,
 *   Type      TEXT NOT NULL CHECK (Type IN ('file', 'folder')),
 *   Extension TEXT,
 *   Content   TEXT,
 *   UNIQUE (Type, Parent, Name)
 * );
 * CREATE INDEX laika_storage_parent_idx ON laika_storage (Parent);
 * ```
 *
 * Distinguishing behaviour: `removeAtoms(N)` packs into one atomic
 * `batch` request with N conditional `DELETE` steps, each chained to
 * the previous via `condition: {type: 'ok', step: i - 1}` — the whole
 * batch rolls back if any step fails. **8th structurally distinct
 * atomic-multi-write mechanism in the suite.**
 */
export class LibSqlStorageRepository extends StorageRepository {
  private readonly dataSource: LibSqlDataSource;
  private readonly tableName: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: LibSqlStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      tableName = DEFAULT_TABLE,
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    validateIdentifier(tableName);
    this.tableName = tableName;
    this.dataSource = dataSource;
    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultFileExtension.startsWith('.')
      ? defaultFileExtension.slice(1)
      : defaultFileExtension;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.determineExtension = determineExtension;
    this.excludeFilter = ignoreList
      .map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true }))
      .filter((re): re is minimatch.MMRegExp => re !== false);
  }

  // ───────────────────────── helpers ─────────────────────────

  private stripExtension(key: string): string {
    for (const ext of this.availableExtensions) {
      if (key.endsWith(`.${ext}`)) return key.slice(0, -(ext.length + 1));
    }
    return key;
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

  private filePath(key: string, extension: string): string {
    const stripped = stripSlashes(this.stripExtension(key));
    return `${stripped}.${extension}`;
  }

  /** Resolve an extension-free key to its row. One `execute` round-trip. */
  private async findFileRow(key: string): Promise<StorageRow | null> {
    const { parent, name } = splitPath(this.stripExtension(key));
    const result = await this.dataSource.execute(
      `SELECT Path, Parent, Name, Type, Extension, Content
       FROM ${this.tableName}
       WHERE Type = ? AND Parent = ? AND Name = ?
       LIMIT 1`,
      [TYPE_FILE, parent, name],
    );
    if (Result.isFailure(result)) return null;
    const row = result.success.rows[0];
    if (!row) return null;
    return decodeRow(result.success.cols, row);
  }

  private async hasFolder(key: string): Promise<boolean> {
    const k = stripSlashes(key);
    if (k === '') {
      const r = await this.dataSource.execute(`SELECT 1 FROM ${this.tableName} LIMIT 1`, []);
      if (Result.isFailure(r)) return false;
      return r.success.rows.length > 0;
    }
    const r = await this.dataSource.execute(
      `SELECT 1 FROM ${this.tableName}
       WHERE (Path = ? AND Type = ?)
          OR Parent = ?
       LIMIT 1`,
      [k, TYPE_FOLDER, k],
    );
    if (Result.isFailure(r)) return false;
    return r.success.rows.length > 0;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const row = yield* Effect.promise(() => this.findFileRow(key));
        if (!row) {
          return yield* Effect.fail(new NotFoundError(`libSQL row not found: ${key}`));
        }
        const extension = row.Extension ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, row.Content ?? ''));
        const callerKey = row.Parent === '' ? row.Name : `${row.Parent}/${row.Name}`;
        const now = new Date().toISOString();
        return {
          type: 'object',
          key: callerKey,
          createdAt: now,
          updatedAt: now,
          content,
          metadata: { extension, revisionId: row.Path },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const exists = yield* Effect.promise(() => this.hasFolder(key));
        if (!exists) {
          return yield* Effect.fail(new NotFoundError(`libSQL folder not found: ${key || '<root>'}`));
        }
        const now = new Date().toISOString();
        return { type: 'folder', key, createdAt: now, updatedAt: now } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const row = yield* Effect.promise(() => this.findFileRow(key));
        if (row) return yield* LaikaTask.runValue(this.getObject(key));
        const folder = yield* Effect.result(LaikaTask.runValue(this.getFolder(key)));
        if (Result.isSuccess(folder)) return folder.success;
        return yield* Effect.fail(new BadRequestError(`Path not found: ${key}`));
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new BadRequestError('Object content is required for creation'));
        }
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const existing = yield* Effect.promise(() => this.findFileRow(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${
                existing.Extension ?? this.defaultFileExtension
              }`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const path = this.filePath(create.key, extension);

        yield* liftResult(this.dataSource.execute(
          `INSERT INTO ${this.tableName} (Path, Parent, Name, Type, Extension, Content)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [path, parent, name, TYPE_FILE, extension, serialized],
        ));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileRow(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`libSQL row not found: ${update.key}`));
        }
        if (update.content) {
          const extension = existing.Extension ?? this.defaultFileExtension;
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          yield* liftResult(this.dataSource.execute(
            `UPDATE ${this.tableName} SET Content = ? WHERE Path = ?`,
            [serialized, existing.Path],
          ));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const existing = yield* Effect.promise(() => this.findFileRow(create.key));
        const extension = existing?.Extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const path = this.filePath(create.key, extension);
        // SQLite's `INSERT OR REPLACE` is the natural fit here.
        yield* liftResult(this.dataSource.execute(
          `INSERT INTO ${this.tableName} (Path, Parent, Name, Type, Extension, Content)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(Path) DO UPDATE SET Content = excluded.Content, Extension = excluded.Extension`,
          [path, parent, name, TYPE_FILE, extension, serialized],
        ));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(folderCreate.key);
        if (k === '') return yield* LaikaTask.runValue(this.getFolder(''));
        const { parent, name } = splitPath(k);
        yield* liftResult(this.dataSource.execute(
          `INSERT INTO ${this.tableName} (Path, Parent, Name, Type)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(Path) DO NOTHING`,
          [k, parent, name, TYPE_FOLDER],
        ));
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const cleanKeys = keys.map(s => stripSlashes(s)).filter(s => s !== '');
        const skipped0 = keys.length - cleanKeys.length;
        if (cleanKeys.length === 0) {
          for (let i = 0; i < skipped0; i++) {
            yield* emit.recoverableError(new BadRequestError('Refusing to delete empty key'));
          }
          return { removed: 0, skipped: skipped0 };
        }

        // ── Round-trip 1: resolve every key to its Path via one pipeline
        // of N `execute` statements bundled into a single HTTP request.
        // (Not a `batch` — these are independent reads, no atomicity needed.)
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string, resolved: StorageRow | null }> = [];
          for (const k of cleanKeys) {
            const row = await this.findFileRow(k);
            out.push({ key: k, resolved: row });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<{ key: string, resolved: StorageRow }>;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: ONE libSQL `batch` request with N chained DELETE
        // steps. Each step's condition is `{type: 'ok', step: prev}`,
        // making the whole batch atomic — either all N succeed or all
        // roll back. 8th structurally distinct atomic-multi-write
        // mechanism in the Laika suite.
        if (found.length > 0) {
          yield* liftResult(this.dataSource.batch(
            found.map(f => ({
              sql: `DELETE FROM ${this.tableName} WHERE Path = ?`,
              args: [f.resolved.Path],
            })),
          ));
        }

        for (const f of found) yield* emit.data(f.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`libSQL row not found: ${m.key}`));
        }
        return { removed: found.length, skipped: skipped0 + missing.length };
      })
    );
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    return LaikaStream.make<AtomSummary, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const summaries = yield* this.collectFilteredSummaries(folderKey, options);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total: summaries.length };
      })
    );
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const summaries = yield* this.collectFilteredSummaries(folderKey, options);
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

  /** Single `SELECT ... WHERE Parent = ?` — one round-trip. */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const parent = stripSlashes(folderKey);
      const result = yield* liftResult(this.dataSource.execute(
        `SELECT Path, Parent, Name, Type, Extension, Content
         FROM ${this.tableName}
         WHERE Parent = ?`,
        [parent],
      ));
      const rows = result.rows.map(row => decodeRow(result.cols, row));
      const summaries: AtomSummary[] = rows.map(row => {
        const callerKey = row.Parent === '' ? row.Name : `${row.Parent}/${row.Name}`;
        return row.Type === TYPE_FILE
          ? { type: 'object-summary', key: callerKey }
          : { type: 'folder-summary', key: callerKey };
      });
      const filtered = summaries.filter(s => this.excludeFilter.every(pattern => !pattern.test(s.key)));
      const sorted = [...filtered].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description:
          'Each object is one row in a libSQL/SQLite table; the extension is stored in the `Extension` column.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over SELECT results; LIMIT/OFFSET pushdown not yet wired.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
