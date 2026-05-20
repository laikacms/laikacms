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

import type { ArangoDataSource, ArangoDocMeta } from './arango-datasource.js';

export interface ArangoStorageRepositoryOptions {
  readonly dataSource: ArangoDataSource;
  /** File collection. Default `laika_files`. */
  readonly fileCollection?: string;
  /** Folder collection. Default `laika_folders`. */
  readonly folderCollection?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_FILE_COLLECTION = 'laika_files';
const DEFAULT_FOLDER_COLLECTION = 'laika_folders';

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

const validateCollectionName = (name: string): void => {
  // ArangoDB collection names: must start with letter, then letters/numbers/-/_
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw new BadRequestError(`Invalid ArangoDB collection name: ${name}`);
  }
};

/**
 * Arango `_key` values must match `[A-Za-z0-9_\-:.@()+,=;$!*'%]`. Slashes
 * are reserved for `_id` (the qualified `collection/key`). For Laika
 * paths with slashes we encode `/` as `--` (a sequence that's
 * vanishingly unlikely to appear in normal CMS paths).
 */
const pathToKey = (path: string): string =>
  stripSlashes(path).replace(/\//g, '--');

const keyToPath = (key: string): string =>
  key.replace(/--/g, '/');

interface StoredRecord {
  _key: string;
  type: 'file' | 'folder';
  path: string;
  parent: string;
  name: string;
  extension?: string;
  content?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A {@link StorageRepository} backed by ArangoDB via the HTTP API. Two
 * document collections — `laika_files` and `laika_folders` — hold the
 * data. Every operation flows through AQL except the upsert path, which
 * uses the direct document endpoint for idempotency.
 *
 * Five AQL idioms shape the wire format:
 *
 *  - **`FOR doc IN collection FILTER … RETURN doc`** — the canonical
 *    AQL read pattern. `getObject`, `findFileRecord`, and
 *    `collectFilteredSummaries` all use this.
 *
 *  - **`FOR doc IN collection FILTER doc.path IN @paths REMOVE doc IN
 *    collection RETURN OLD._key`** — atomic bulk delete via AQL. **The
 *    17th structurally distinct atomic-multi-write mechanism in the
 *    suite**: single AQL traversal-with-REMOVE that runs as one
 *    transaction.
 *
 *  - **`INSERT @doc INTO collection RETURN NEW`** — AQL insert with
 *    returning. The repository uses this for create operations to get
 *    back the `_rev` for surfacing as `revisionId`.
 *
 *  - **`UPDATE @key WITH @changes IN collection RETURN NEW`** — AQL
 *    update by document key. Distinct from SQL's `UPDATE ... SET`.
 *
 *  - **`@param`-style bind vars** (NOT `:param`, `$param`, or `?`).
 *    First backend using `@` as the bind-variable sigil.
 *
 * `_key` uses `--` as the slash-replacement encoding since Arango
 * reserves `/` for the qualified `_id` (`collection/key`).
 */
export class ArangoStorageRepository extends StorageRepository {
  private readonly dataSource: ArangoDataSource;
  private readonly fileCollection: string;
  private readonly folderCollection: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: ArangoStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      fileCollection = DEFAULT_FILE_COLLECTION,
      folderCollection = DEFAULT_FOLDER_COLLECTION,
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    validateCollectionName(fileCollection);
    validateCollectionName(folderCollection);

    this.dataSource = dataSource;
    this.fileCollection = fileCollection;
    this.folderCollection = folderCollection;
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
   * Resolve an extension-free key to its file record via one AQL query.
   * Indexed lookup on `(parent, name)` if the user has declared the
   * recommended persistent index.
   */
  private async findFileRecord(key: string): Promise<(StoredRecord & ArangoDocMeta) | null> {
    const { parent, name } = splitPath(this.stripExtension(key));
    const r = await this.dataSource.aql<StoredRecord & ArangoDocMeta>(
      `FOR doc IN ${this.fileCollection}
         FILTER doc.type == @type AND doc.parent == @parent AND doc.name == @name
         LIMIT 1
         RETURN doc`,
      { type: TYPE_FILE, parent, name },
    );
    if (Result.isFailure(r)) return null;
    return r.success[0] ?? null;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const row = yield* Effect.promise(() => this.findFileRecord(key));
        if (!row) {
          return yield* Effect.fail(new NotFoundError(`ArangoDB document not found: ${key}`));
        }
        const extension = row.extension ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, row.content ?? ''));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: row.createdAt ?? new Date(0).toISOString(),
          updatedAt: row.updatedAt ?? new Date(0).toISOString(),
          content,
          // `_rev` is Arango's optimistic-concurrency token — bumped on
          // every write, server-managed.
          metadata: { extension, revisionId: row._rev },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        if (k === '') {
          // Root — succeed if anything exists.
          const probe = yield* liftResult(this.dataSource.aql<unknown>(
            `FOR doc IN ${this.fileCollection} LIMIT 1 RETURN doc`,
          ));
          if (probe.length === 0) {
            return yield* Effect.fail(new NotFoundError('ArangoDB root folder is empty'));
          }
          const now = new Date().toISOString();
          return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
        }
        // Explicit folder doc?
        const explicit = yield* liftResult(this.dataSource.getDocument<StoredRecord>(
          this.folderCollection,
          pathToKey(k),
        ));
        if (explicit) {
          return {
            type: 'folder',
            key: k,
            createdAt: explicit.createdAt ?? new Date(0).toISOString(),
            updatedAt: explicit.updatedAt ?? new Date(0).toISOString(),
          } satisfies Folder;
        }
        // Implicit folder — any descendant file?
        const childProbe = yield* liftResult(this.dataSource.aql<unknown>(
          `FOR doc IN ${this.fileCollection}
             FILTER doc.parent == @parent
             LIMIT 1
             RETURN doc`,
          { parent: k },
        ));
        if (childProbe.length > 0) {
          const now = new Date().toISOString();
          return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
        }
        return yield* Effect.fail(new NotFoundError(`ArangoDB folder not found: ${k}`));
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const file = yield* Effect.promise(() => this.findFileRecord(key));
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
        const doc: StoredRecord = {
          _key: pathToKey(fullPath),
          type: TYPE_FILE,
          path: fullPath,
          parent, name,
          extension,
          content: serialized,
          createdAt: now,
          updatedAt: now,
        };
        // `INSERT @doc INTO collection` — AQL idiom for inserts with
        // RETURN NEW (we discard the return since we re-fetch below).
        yield* liftResult(this.dataSource.aql(
          `INSERT @doc INTO ${this.fileCollection} RETURN NEW`,
          { doc },
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
          return yield* Effect.fail(new NotFoundError(`ArangoDB document not found: ${update.key}`));
        }
        if (update.content) {
          const extension = existing.extension ?? this.defaultFileExtension;
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          // `UPDATE @key WITH @changes IN collection` — AQL by-key update.
          yield* liftResult(this.dataSource.aql(
            `UPDATE @key WITH @changes IN ${this.fileCollection} RETURN NEW`,
            { key: existing._key, changes: { content: serialized, updatedAt: new Date().toISOString() } },
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
        const doc: StoredRecord = {
          _key: pathToKey(fullPath),
          type: TYPE_FILE,
          path: fullPath,
          parent, name,
          extension,
          content: serialized,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        // Direct document upsert (replace mode) for idempotency. The AQL
        // alternative is `UPSERT @lookup INSERT @doc UPDATE @changes` —
        // wordier than the REST shortcut.
        yield* liftResult(this.dataSource.upsertDocument(this.fileCollection, doc, { overwriteMode: 'replace' }));
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
        yield* liftResult(this.dataSource.upsertDocument(this.folderCollection, {
          _key: pathToKey(k),
          type: TYPE_FOLDER,
          path: k,
          parent, name,
          createdAt: now,
          updatedAt: now,
        } as StoredRecord, { overwriteMode: 'ignore' }));
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

  /**
   * **The load-bearing distinctive behaviour:** `removeAtoms(N)` ships
   * as ONE AQL query that traverses the bound paths and REMOVES each.
   * The whole query runs as one transaction per AQL semantics.
   *
   * ```aql
   * FOR doc IN laika_files
   *   FILTER doc.path IN @paths
   *   REMOVE doc IN laika_files
   *   RETURN OLD._key
   * ```
   *
   * **The 17th structurally distinct atomic-multi-write mechanism in
   * the suite** — single AQL traversal-with-REMOVE.
   */
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
          const out: Array<{ key: string; resolved: (StoredRecord & ArangoDocMeta) | null }> = [];
          for (const k of cleanKeys) {
            out.push({ key: k, resolved: await this.findFileRecord(k) });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<{
          key: string; resolved: StoredRecord & ArangoDocMeta;
        }>;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: ONE AQL `FOR ... REMOVE` query, atomic at the
        // collection level.
        if (found.length > 0) {
          const paths = found.map(f => f.resolved.path);
          yield* liftResult(this.dataSource.aql<string>(
            `FOR doc IN ${this.fileCollection}
               FILTER doc.path IN @paths
               REMOVE doc IN ${this.fileCollection}
               RETURN OLD._key`,
            { paths },
          ));
        }

        for (const f of found) yield* emit.data(f.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`ArangoDB document not found: ${m.key}`));
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

  /** Two AQL queries — one per collection — joined client-side. */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const parent = stripSlashes(folderKey);
      const fileRows = yield* liftResult(this.dataSource.aql<StoredRecord>(
        `FOR doc IN ${this.fileCollection}
           FILTER doc.parent == @parent
           RETURN doc`,
        { parent },
      ));
      const folderRows = yield* liftResult(this.dataSource.aql<StoredRecord>(
        `FOR doc IN ${this.folderCollection}
           FILTER doc.parent == @parent
           RETURN doc`,
        { parent },
      ));

      const callerPrefix = parent === '' ? '' : `${parent}/`;
      const files: AtomSummary[] = fileRows.map(r => ({
        type: 'object-summary', key: callerPrefix + r.name,
      }));
      const folders: AtomSummary[] = folderRows.map(r => ({
        type: 'folder-summary', key: callerPrefix + r.name,
      }));
      const merged = [...files, ...folders]
        .filter(s => this.excludeFilter.every(p => !p.test(s.key)));
      const sorted = [...merged].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Each object is one ArangoDB document; the extension is stored in the `extension` field.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over AQL cursor results; LIMIT/OFFSET pushdown not yet wired.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}

/** Export the key-encoding helpers in case app code needs to construct `_key` values. */
export { pathToKey, keyToPath };
