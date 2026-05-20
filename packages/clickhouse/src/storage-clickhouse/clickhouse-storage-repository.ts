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

import type { ClickHouseDataSource } from './clickhouse-datasource.js';

export interface ClickHouseStorageRepositoryOptions {
  readonly dataSource: ClickHouseDataSource;
  /** Table name. Default `laika_storage`. */
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

const splitPath = (key: string): { parent: string; name: string } => {
  const k = stripSlashes(key);
  const last = k.lastIndexOf('/');
  if (last === -1) return { parent: '', name: k };
  return { parent: k.slice(0, last), name: k.slice(last + 1) };
};

/** SQL injection guard for the table identifier. */
const validateIdentifier = (name: string): void => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new BadRequestError(`Invalid SQL identifier: ${name}`);
  }
};

interface StorageRow {
  path: string;
  parent: string;
  name: string;
  type: 'file' | 'folder';
  extension?: string;
  content?: string;
  version?: string | number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A {@link StorageRepository} backed by a ClickHouse `ReplacingMergeTree`
 * table. Designed around ClickHouse's append-mostly OLAP model — every
 * write is an INSERT with a monotonically increasing `version` column;
 * `ReplacingMergeTree` deduplicates by ORDER BY key, keeping the row
 * with the highest version.
 *
 * Recommended schema (provision once via `clickhouse-client` or the UI):
 *
 * ```sql
 * CREATE TABLE laika_storage (
 *   path       String,
 *   parent     String,
 *   name       String,
 *   type       LowCardinality(String),
 *   extension  String DEFAULT '',
 *   content    String DEFAULT '',
 *   version    UInt64 DEFAULT toUnixTimestamp64Milli(now64()),
 *   createdAt  String DEFAULT toString(now64()),
 *   updatedAt  String DEFAULT toString(now64())
 * ) ENGINE = ReplacingMergeTree(version)
 * PRIMARY KEY (type, parent, name)
 * ORDER BY (type, parent, name);
 * ```
 *
 * Four ClickHouse idioms shape the wire format:
 *
 *  - **`INSERT … FORMAT JSONEachRow` + NDJSON body.** Writes batch
 *    naturally via the streaming format; we send N rows in one HTTP
 *    request, body is `{...}\n{...}\n{...}\n`.
 *
 *  - **`SELECT … FROM table FINAL`.** The `FINAL` keyword forces a
 *    merge-on-read for `ReplacingMergeTree`, returning the latest
 *    version per ORDER BY key. **First backend in the suite using
 *    explicit consistency-vs-performance read modifiers.**
 *
 *  - **`?query=…` URL parameter for SELECTs.** SQL lives in the URL,
 *    body stays empty (or carries INSERT data). **First backend
 *    where SQL and payload occupy different parts of the wire envelope.**
 *
 *  - **`DELETE FROM … WHERE path IN (?, ?, …)` lightweight deletes.**
 *    `removeAtoms(N)` packs into a single statement — same shape as
 *    Supabase PostgREST (iter 24); not a new atomic mechanism, but
 *    significant in OLAP context since older ClickHouse versions
 *    required `ALTER TABLE ... DELETE` mutations (asynchronous,
 *    eventual). Modern lightweight deletes are synchronous at the
 *    statement level.
 *
 * Tracks the doesn't-add-a-new-atomic-mechanism honesty bar set by
 * iter 34 (Solid Pod): novelty is in the wire format and engine
 * semantics, not a new atomic primitive.
 */
export class ClickHouseStorageRepository extends StorageRepository {
  private readonly dataSource: ClickHouseDataSource;
  private readonly tableName: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: ClickHouseStorageRepositoryOptions) {
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
    this.dataSource = dataSource;
    this.tableName = tableName;
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

  /**
   * Resolve an extension-free key to its row via a single SELECT FINAL.
   * The `FINAL` modifier ensures latest-version-wins semantics for the
   * `ReplacingMergeTree` engine — without it, in-flight merges might
   * surface older versions.
   *
   *     SELECT path, parent, name, type, extension, content, version
   *     FROM laika_storage FINAL
   *     WHERE type = {type:String} AND parent = {parent:String} AND name = {name:String}
   *     LIMIT 1
   */
  private async findFileRow(key: string): Promise<StorageRow | null> {
    const { parent, name } = splitPath(this.stripExtension(key));
    const r = await this.dataSource.query<StorageRow>(
      `SELECT path, parent, name, type, extension, content, version, createdAt, updatedAt
       FROM ${this.tableName} FINAL
       WHERE type = {type:String} AND parent = {parent:String} AND name = {name:String}
       LIMIT 1`,
      { type: TYPE_FILE, parent, name },
    );
    if (Result.isFailure(r)) return null;
    return r.success[0] ?? null;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const row = yield* Effect.promise(() => this.findFileRow(key));
        if (!row) {
          return yield* Effect.fail(new NotFoundError(`ClickHouse row not found: ${key}`));
        }
        const extension = row.extension ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, row.content ?? ''));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: row.createdAt ?? new Date(0).toISOString(),
          updatedAt: row.updatedAt ?? new Date(0).toISOString(),
          content,
          // ClickHouse exposes the row's monotonic version — that IS the
          // revision identifier (the ReplacingMergeTree dedup key).
          metadata: { extension, revisionId: String(row.version ?? row.path) },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        if (k === '') {
          const probe = yield* liftResult(this.dataSource.query<{ c: number }>(
            `SELECT count() AS c FROM ${this.tableName} FINAL`,
          ));
          if ((probe[0]?.c ?? 0) === 0) {
            return yield* Effect.fail(new NotFoundError('ClickHouse root folder is empty'));
          }
          const now = new Date().toISOString();
          return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
        }
        const explicit = yield* liftResult(this.dataSource.query<StorageRow>(
          `SELECT * FROM ${this.tableName} FINAL
           WHERE type = {type:String} AND path = {path:String}
           LIMIT 1`,
          { type: TYPE_FOLDER, path: k },
        ));
        if (explicit.length > 0) {
          const row = explicit[0]!;
          return {
            type: 'folder',
            key: k,
            createdAt: row.createdAt ?? new Date(0).toISOString(),
            updatedAt: row.updatedAt ?? new Date(0).toISOString(),
          } satisfies Folder;
        }
        // Implicit folder — any descendant?
        const child = yield* liftResult(this.dataSource.query<{ c: number }>(
          `SELECT count() AS c FROM ${this.tableName} FINAL WHERE parent = {parent:String}`,
          { parent: k },
        ));
        if ((child[0]?.c ?? 0) > 0) {
          const now = new Date().toISOString();
          return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
        }
        return yield* Effect.fail(new NotFoundError(`ClickHouse folder not found: ${k}`));
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const file = yield* Effect.promise(() => this.findFileRow(key));
        if (file) return yield* LaikaTask.runValue(this.getObject(key));
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
        const existing = yield* Effect.promise(() => this.findFileRow(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension ?? this.defaultFileExtension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const fullPath = this.filePath(create.key, extension);
        const now = new Date().toISOString();
        // INSERT via NDJSON streaming format — the load-bearing wire shape
        // of this backend.
        yield* liftResult(this.dataSource.insertRows(this.tableName, [{
          path: fullPath,
          parent, name,
          type: TYPE_FILE,
          extension,
          content: serialized,
          version: Date.now(),
          createdAt: now,
          updatedAt: now,
        }]));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileRow(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`ClickHouse row not found: ${update.key}`));
        }
        if (update.content) {
          const extension = existing.extension ?? this.defaultFileExtension;
          const serialized = yield* Effect.promise(() =>
            this.serialize(extension, update.content!),
          );
          // ReplacingMergeTree semantics — re-insert with a newer version
          // and the old row is dedup'd away on the next merge. Reads with
          // FINAL see the new row immediately.
          yield* liftResult(this.dataSource.insertRows(this.tableName, [{
            path: existing.path,
            parent: existing.parent,
            name: existing.name,
            type: TYPE_FILE,
            extension,
            content: serialized,
            version: Date.now(),
            createdAt: existing.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }]));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileRow(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const fullPath = existing?.path ?? this.filePath(create.key, extension);
        const now = new Date().toISOString();
        // Always INSERT — ReplacingMergeTree dedups on background merge.
        // No conditional INSERT-or-UPDATE needed at the application layer.
        yield* liftResult(this.dataSource.insertRows(this.tableName, [{
          path: fullPath,
          parent, name,
          type: TYPE_FILE,
          extension,
          content: serialized,
          version: Date.now(),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }]));
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
        const now = new Date().toISOString();
        // Idempotent — re-inserting an identical folder produces a new
        // version that dedups away on merge.
        yield* liftResult(this.dataSource.insertRows(this.tableName, [{
          path: k,
          parent, name,
          type: TYPE_FOLDER,
          extension: '',
          content: '',
          version: Date.now(),
          createdAt: now,
          updatedAt: now,
        }]));
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

        // ── Round-trip 1: resolve every key to its full path.
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string; resolved: StorageRow | null }> = [];
          for (const k of cleanKeys) {
            out.push({ key: k, resolved: await this.findFileRow(k) });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<{ key: string; resolved: StorageRow }>;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: single lightweight DELETE with IN-list.
        // (Same shape as Supabase PostgREST iter 24 — not a new atomic
        // mechanism. The novelty in this backend is elsewhere: NDJSON
        // streaming wire format, ReplacingMergeTree semantics, FINAL
        // reads.)
        if (found.length > 0) {
          // ClickHouse parameterised queries support `Array(String)` —
          // bind the IN-list as a single typed array parameter.
          const paths = found.map(f => f.resolved.path);
          // Encode as a literal tuple: ('a', 'b', 'c'). Each path is
          // SQL-string-escaped (`'` → `\'`).
          const escapedList = paths
            .map(p => `'${p.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
            .join(', ');
          yield* liftResult(this.dataSource.exec(
            `DELETE FROM ${this.tableName}
             WHERE type = 'file' AND path IN (${escapedList})
             SETTINGS mutations_sync = 1`,
          ));
        }

        for (const f of found) yield* emit.data(f.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`ClickHouse row not found: ${m.key}`));
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

  /**
   * Single `SELECT ... FROM table FINAL WHERE parent = ?` — one
   * round-trip. The `FINAL` modifier costs some read performance but
   * guarantees latest-version visibility, which the listing semantics
   * require.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const parent = stripSlashes(folderKey);
      const rows = yield* liftResult(this.dataSource.query<StorageRow>(
        `SELECT path, parent, name, type, extension
         FROM ${this.tableName} FINAL
         WHERE parent = {parent:String}`,
        { parent },
      ));
      const summaries: AtomSummary[] = rows.map((row) => {
        const callerKey = row.parent === '' ? row.name : `${row.parent}/${row.name}`;
        return row.type === TYPE_FILE
          ? { type: 'object-summary', key: callerKey }
          : { type: 'folder-summary', key: callerKey };
      });
      const filtered = summaries.filter(s => this.excludeFilter.every(p => !p.test(s.key)));
      const sorted = [...filtered].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Each object is one row in a ClickHouse ReplacingMergeTree table; the extension is stored in the `extension` column.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over JSONEachRow streams; native LIMIT/OFFSET pushdown not yet wired.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
