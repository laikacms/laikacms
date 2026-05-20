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

import type { SurrealDbDataSource } from './surrealdb-datasource.js';

export interface SurrealDbStorageRepositoryOptions {
  readonly dataSource: SurrealDbDataSource;
  /** Default table for file records. Default `laika_file`. */
  readonly fileTable?: string;
  /** Default table for folder records. Default `laika_folder`. */
  readonly folderTable?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_FILE_TABLE = 'laika_file';
const DEFAULT_FOLDER_TABLE = 'laika_folder';

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.contentbase',
  '**/.laikacms',
];

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const stripSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitPath = (key: string): { parent: string; name: string } => {
  const k = stripSlashes(key);
  const last = k.lastIndexOf('/');
  if (last === -1) return { parent: '', name: k };
  return { parent: k.slice(0, last), name: k.slice(last + 1) };
};

/** Stored record shape — what we write into the file/folder tables. */
interface StoredRecord {
  id?: string;             // SurrealDB returns this as `<table>:<id>`
  path: string;
  parent: string;
  name: string;
  extension?: string;
  content?: string;
  type: 'file' | 'folder';
  createdAt: string;
  updatedAt: string;
}

/** SQL-injection guard for table names. */
const validateIdentifier = (name: string): void => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new BadRequestError(`Invalid SQL identifier: ${name}`);
  }
};

/**
 * A {@link StorageRepository} backed by a SurrealDB cluster, talking the
 * HTTP `/sql` endpoint over `fetch`. Every Laika atom becomes a row in
 * one of two tables — `laika_file` or `laika_folder` — with the path
 * used as the SurrealDB record id.
 *
 * Four traits distinguish this backend from every prior SQL-ish store:
 *
 *  - **`type::thing("table", $path)`-shaped record references.** SurQL
 *    treats `<table>:<id>` as a first-class composite identifier; we
 *    construct them via the `type::thing()` function for safe binding
 *    of arbitrary paths (slashes, special characters — all fine).
 *
 *  - **NS / DB header isolation.** Namespace and database are scoped
 *    via the `NS:` and `DB:` HTTP headers. Multiple Laika instances
 *    share a cluster by handing the data source distinct (namespace,
 *    database) pairs.
 *
 *  - **BEGIN / COMMIT transactions over SurQL.** `removeAtoms(N)`
 *    ships as one `POST /sql` body containing
 *    `BEGIN TRANSACTION; DELETE ...; DELETE ...; ...; COMMIT TRANSACTION;`.
 *    Atomic, one HTTP round-trip — **the 12th structurally distinct
 *    atomic-multi-write mechanism in the Laika suite.**
 *
 *  - **Per-statement result envelopes.** Even a single-statement query
 *    returns an array; the data source's `one()` helper unwraps to
 *    keep the repository code clean. Transactions return per-statement
 *    results in the same shape — partial failures are observable
 *    per-step.
 */
export class SurrealDbStorageRepository extends StorageRepository {
  private readonly dataSource: SurrealDbDataSource;
  private readonly fileTable: string;
  private readonly folderTable: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: SurrealDbStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      fileTable = DEFAULT_FILE_TABLE,
      folderTable = DEFAULT_FOLDER_TABLE,
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    validateIdentifier(fileTable);
    validateIdentifier(folderTable);

    this.dataSource = dataSource;
    this.fileTable = fileTable;
    this.folderTable = folderTable;
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
   * Resolve an extension-free key to its file record. One SurQL statement:
   *
   *     SELECT * FROM <fileTable> WHERE type = "file" AND parent = $parent
   *                                AND name = $name LIMIT 1
   */
  private async findFileRecord(key: string): Promise<StoredRecord | null> {
    const { parent, name } = splitPath(this.stripExtension(key));
    const r = await this.dataSource.one<StoredRecord[]>(
      `SELECT * FROM ${this.fileTable} WHERE type = "file" AND parent = $parent AND name = $name LIMIT 1`,
      { parent, name },
    );
    if (Result.isFailure(r)) return null;
    return r.success[0] ?? null;
  }

  private async hasFolder(key: string): Promise<boolean> {
    const k = stripSlashes(key);
    if (k === '') {
      const r = await this.dataSource.one<StoredRecord[]>(
        `SELECT id FROM ${this.fileTable} LIMIT 1`,
      );
      if (Result.isFailure(r)) return false;
      if (r.success.length > 0) return true;
      const fr = await this.dataSource.one<StoredRecord[]>(
        `SELECT id FROM ${this.folderTable} LIMIT 1`,
      );
      if (Result.isFailure(fr)) return false;
      return fr.success.length > 0;
    }
    // Either an explicit folder record exists at this path, OR any descendant.
    const probe = await this.dataSource.one<StoredRecord[]>(
      `SELECT id FROM ${this.folderTable} WHERE path = $path LIMIT 1`,
      { path: k },
    );
    if (Result.isSuccess(probe) && probe.success.length > 0) return true;
    const childProbe = await this.dataSource.one<StoredRecord[]>(
      `SELECT id FROM ${this.fileTable} WHERE parent = $parent LIMIT 1`,
      { parent: k },
    );
    if (Result.isSuccess(childProbe) && childProbe.success.length > 0) return true;
    const subFolderProbe = await this.dataSource.one<StoredRecord[]>(
      `SELECT id FROM ${this.folderTable} WHERE parent = $parent LIMIT 1`,
      { parent: k },
    );
    return Result.isSuccess(subFolderProbe) && subFolderProbe.success.length > 0;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const row = yield* Effect.promise(() => this.findFileRecord(key));
        if (!row) {
          return yield* Effect.fail(new NotFoundError(`SurrealDB record not found: ${key}`));
        }
        const extension = row.extension ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, row.content ?? ''));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: row.createdAt ?? new Date(0).toISOString(),
          updatedAt: row.updatedAt ?? new Date(0).toISOString(),
          content,
          // The SurrealDB record id (`<table>:<id>`) is the canonical
          // revisionId — it changes when path changes, but stays stable
          // across content updates. Conceptually similar to a primary key.
          metadata: { extension, revisionId: row.id ?? '' },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const exists = yield* Effect.promise(() => this.hasFolder(key));
        if (!exists) {
          return yield* Effect.fail(new NotFoundError(`SurrealDB folder not found: ${key || '<root>'}`));
        }
        const now = new Date().toISOString();
        return { type: 'folder', key: stripSlashes(key), createdAt: now, updatedAt: now } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const row = yield* Effect.promise(() => this.findFileRecord(key));
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
        const existing = yield* Effect.promise(() => this.findFileRecord(create.key));
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
        const record: StoredRecord = {
          path: fullPath,
          parent,
          name,
          extension,
          content: serialized,
          type: 'file',
          createdAt: now,
          updatedAt: now,
        };

        // `CREATE type::thing("laika_file", $path)` — type::thing safely
        // constructs the table:id record reference from arbitrary input.
        yield* liftResult(this.dataSource.one(
          `CREATE type::thing($table, $path) CONTENT $value`,
          { table: this.fileTable, path: fullPath, value: record },
        ));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileRecord(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`SurrealDB record not found: ${update.key}`));
        }
        if (update.content) {
          const extension = existing.extension ?? this.defaultFileExtension;
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          // `UPDATE type::thing(...)` MERGE patches selected fields.
          yield* liftResult(this.dataSource.one(
            `UPDATE type::thing($table, $path) MERGE $merge`,
            {
              table: this.fileTable,
              path: existing.path,
              merge: { content: serialized, updatedAt: new Date().toISOString() },
            },
          ));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileRecord(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const fullPath = this.filePath(create.key, extension);
        const now = new Date().toISOString();
        const record: StoredRecord = {
          path: fullPath,
          parent,
          name,
          extension,
          content: serialized,
          type: 'file',
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        // SurQL's `UPSERT` is the natural fit — creates on missing, updates
        // when present.
        yield* liftResult(this.dataSource.one(
          `UPSERT type::thing($table, $path) CONTENT $value`,
          { table: this.fileTable, path: fullPath, value: record },
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
        const now = new Date().toISOString();
        const record: StoredRecord = {
          path: k,
          parent,
          name,
          type: 'folder',
          createdAt: now,
          updatedAt: now,
        };
        // UPSERT for idempotency — repeated createFolder calls don't error.
        yield* liftResult(this.dataSource.one(
          `UPSERT type::thing($table, $path) CONTENT $value`,
          { table: this.folderTable, path: k, value: record },
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

        // ── Round-trip 1: resolve every key to its full path via N parallel SELECTs.
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string; resolved: StoredRecord | null }> = [];
          for (const k of cleanKeys) {
            const row = await this.findFileRecord(k);
            out.push({ key: k, resolved: row });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<{ key: string; resolved: StoredRecord }>;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: ONE BEGIN/COMMIT transaction with N DELETE
        // statements. Atomic — partial failures roll back. The whole SurQL
        // string is built and posted to `/sql` in a single HTTP request.
        if (found.length > 0) {
          yield* liftResult(this.dataSource.transaction(
            found.map(f => ({
              surql: `DELETE type::thing($table, $path)`,
              vars: { table: this.fileTable, path: f.resolved.path },
            })),
          ));
        }

        for (const f of found) yield* emit.data(f.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`SurrealDB record not found: ${m.key}`));
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
   * Two SELECTs — one per table — joined client-side. Could be one
   * SurQL via subqueries, but the two-statement form is clearer here.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const parent = stripSlashes(folderKey);
      const fileRows = yield* liftResult(this.dataSource.one<StoredRecord[]>(
        `SELECT * FROM ${this.fileTable} WHERE parent = $parent`,
        { parent },
      ));
      const folderRows = yield* liftResult(this.dataSource.one<StoredRecord[]>(
        `SELECT * FROM ${this.folderTable} WHERE parent = $parent`,
        { parent },
      ));
      const callerPrefix = parent === '' ? '' : `${parent}/`;
      const files: AtomSummary[] = fileRows.map(r => ({
        type: 'object-summary',
        key: callerPrefix + r.name,
      }));
      const folders: AtomSummary[] = folderRows.map(r => ({
        type: 'folder-summary',
        key: callerPrefix + r.name,
      }));
      const merged = [...files, ...folders]
        .filter(s => this.excludeFilter.every(pattern => !pattern.test(s.key)));
      const sorted = [...merged].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Each object is one SurrealDB record; the extension is stored in the `extension` field and encoded in the record id.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over SurQL SELECT results; LIMIT/START pushdown not yet wired.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
