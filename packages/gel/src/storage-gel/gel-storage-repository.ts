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

import type { GelDataSource } from './gel-datasource.js';

export interface GelStorageRepositoryOptions {
  readonly dataSource: GelDataSource;
  /** EdgeQL type name for file records. Default `LaikaFile`. */
  readonly fileType?: string;
  /** EdgeQL type name for folder records. Default `LaikaFolder`. */
  readonly folderType?: string;
  /** Optional `module::Type` qualifier; default is the unqualified type name. */
  readonly moduleName?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_FILE_TYPE = 'LaikaFile';
const DEFAULT_FOLDER_TYPE = 'LaikaFolder';

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

/** EdgeQL identifier guard — type names and module names. */
const validateIdentifier = (name: string): void => {
  // EdgeQL identifiers are PascalCase or snake_case; module names are
  // lowercase. We accept either to be flexible. No `::` allowed in the
  // value passed to validateIdentifier; the moduleName is interpolated
  // separately.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new BadRequestError(`Invalid EdgeQL identifier: ${name}`);
  }
};

interface StoredRow {
  id?: string;
  path: string;
  parent: string;
  name: string;
  extension?: string | null;
  content?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A {@link StorageRepository} backed by Gel (formerly EdgeDB) via the
 * HTTP EdgeQL endpoint. Each Laika atom is one row of an EdgeQL object
 * type — `LaikaFile` or `LaikaFolder` by default. Five EdgeQL idioms
 * shape the wire format:
 *
 *  - **Object-shape literals on writes.** `INSERT LaikaFile { path :=
 *    <str>$path, parent := <str>$parent, … }`. The `:=` operator
 *    assigns; `=` is reserved for equality comparison. First backend
 *    in the suite with this assignment/comparison distinction at the
 *    wire level.
 *
 *  - **Object-shape literals on reads.** `SELECT LaikaFile { id, path,
 *    parent, content }`. The shape determines which properties are
 *    materialised; un-mentioned properties are NOT loaded — column
 *    pruning at the query level.
 *
 *  - **`<type>$param` typed parameter casts.** Every parameter
 *    reference declares its type: `<str>$path`, `<array<str>>$paths`.
 *    Different from libSQL's typed-object wire format (where the type
 *    travels separately from the SQL).
 *
 *  - **`FOR x IN ... UNION ( query x )`.** Set comprehension as the
 *    atomic batch primitive. `removeAtoms(N)` ships as one query
 *    iterating an `array<str>` parameter — single statement, one
 *    transaction, all-or-nothing. **The 15th structurally distinct
 *    atomic-multi-write mechanism in the suite.**
 *
 *  - **`UNLESS CONFLICT ON .property ELSE existing`.** EdgeQL's
 *    UPSERT-with-fallback idiom. Returns either the inserted object
 *    or the existing one — useful for idempotent folder creation.
 */
export class GelStorageRepository extends StorageRepository {
  private readonly dataSource: GelDataSource;
  private readonly fileType: string;
  private readonly folderType: string;
  private readonly moduleName: string | undefined;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: GelStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      fileType = DEFAULT_FILE_TYPE,
      folderType = DEFAULT_FOLDER_TYPE,
      moduleName,
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    validateIdentifier(fileType);
    validateIdentifier(folderType);
    if (moduleName !== undefined) validateIdentifier(moduleName);

    this.dataSource = dataSource;
    this.fileType = fileType;
    this.folderType = folderType;
    this.moduleName = moduleName;
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

  /** Qualified type name (`module::Type`) for use inside EdgeQL queries. */
  private qualifyType(type: string): string {
    return this.moduleName ? `${this.moduleName}::${type}` : type;
  }

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
   * Resolve an extension-free key to its file row via one EdgeQL query:
   *
   *     SELECT LaikaFile { id, path, parent, name, extension, content, createdAt, updatedAt }
   *     FILTER .parent = <str>$parent AND .name = <str>$name LIMIT 1
   *
   * Indexed on `(parent, name)` if the user has declared the suggested
   * schema index.
   */
  private async findFileRow(key: string): Promise<StoredRow | null> {
    const { parent, name } = splitPath(this.stripExtension(key));
    const r = await this.dataSource.one<StoredRow>(
      `SELECT ${this.qualifyType(this.fileType)} { id, path, parent, name, extension, content, createdAt, updatedAt }
       FILTER .parent = <str>$parent AND .name = <str>$name LIMIT 1`,
      { parent, name },
    );
    if (Result.isFailure(r)) return null;
    return r.success;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const row = yield* Effect.promise(() => this.findFileRow(key));
        if (!row) {
          return yield* Effect.fail(new NotFoundError(`Gel row not found: ${key}`));
        }
        const extension = row.extension ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, row.content ?? ''));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: row.createdAt ?? new Date(0).toISOString(),
          updatedAt: row.updatedAt ?? new Date(0).toISOString(),
          content,
          // Gel auto-generates UUID ids for every object — surface as revisionId.
          metadata: { extension, revisionId: row.id ?? row.path },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        if (k === '') {
          const probe = yield* liftResult(this.dataSource.one<{ id: string }>(
            `SELECT ${this.qualifyType(this.fileType)} { id } LIMIT 1`,
          ));
          if (probe) {
            const now = new Date().toISOString();
            return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
          }
          const folderProbe = yield* liftResult(this.dataSource.one<{ id: string }>(
            `SELECT ${this.qualifyType(this.folderType)} { id } LIMIT 1`,
          ));
          if (folderProbe) {
            const now = new Date().toISOString();
            return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
          }
          return yield* Effect.fail(new NotFoundError('Gel root folder is empty'));
        }
        const explicit = yield* liftResult(this.dataSource.one<StoredRow>(
          `SELECT ${this.qualifyType(this.folderType)} { id, path, parent, name, createdAt, updatedAt }
           FILTER .path = <str>$path LIMIT 1`,
          { path: k },
        ));
        if (explicit) {
          return {
            type: 'folder',
            key: k,
            createdAt: explicit.createdAt ?? new Date(0).toISOString(),
            updatedAt: explicit.updatedAt ?? new Date(0).toISOString(),
          } satisfies Folder;
        }
        // Implicit folder: any descendant file with this as parent?
        const childProbe = yield* liftResult(this.dataSource.one<{ id: string }>(
          `SELECT ${this.qualifyType(this.fileType)} { id } FILTER .parent = <str>$parent LIMIT 1`,
          { parent: k },
        ));
        if (childProbe) {
          const now = new Date().toISOString();
          return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
        }
        return yield* Effect.fail(new NotFoundError(`Gel folder not found: ${k}`));
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
        // `:=` is the EdgeQL assignment operator (not `=`, which is comparison).
        // This is the load-bearing distinction in the wire format.
        yield* liftResult(this.dataSource.query(
          `INSERT ${this.qualifyType(this.fileType)} {
             path := <str>$path,
             parent := <str>$parent,
             name := <str>$name,
             extension := <str>$extension,
             content := <str>$content,
             createdAt := <str>$now,
             updatedAt := <str>$now
           }`,
          { path: fullPath, parent, name, extension, content: serialized, now },
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
          return yield* Effect.fail(new NotFoundError(`Gel row not found: ${update.key}`));
        }
        if (update.content) {
          const extension = existing.extension ?? this.defaultFileExtension;
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          yield* liftResult(this.dataSource.query(
            `UPDATE ${this.qualifyType(this.fileType)}
             FILTER .path = <str>$path
             SET { content := <str>$content, updatedAt := <str>$now }`,
            { path: existing.path, content: serialized, now: new Date().toISOString() },
          ));
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
        const fullPath = this.filePath(create.key, extension);
        const now = new Date().toISOString();
        // `UNLESS CONFLICT ON .path ELSE ( UPDATE … )` — EdgeQL's
        // UPSERT idiom. On conflict the ELSE branch runs as the
        // alternate action. First backend in the suite with this
        // INSERT-or-UPDATE conditional form.
        yield* liftResult(this.dataSource.query(
          `INSERT ${this.qualifyType(this.fileType)} {
             path := <str>$path, parent := <str>$parent, name := <str>$name,
             extension := <str>$extension, content := <str>$content,
             createdAt := <str>$now, updatedAt := <str>$now
           }
           UNLESS CONFLICT ON .path
           ELSE (
             UPDATE ${this.qualifyType(this.fileType)}
             SET { content := <str>$content, updatedAt := <str>$now }
           )`,
          { path: fullPath, parent, name, extension, content: serialized, now },
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
        // UNLESS CONFLICT ON .path with no ELSE branch — idempotent
        // insert; existing rows are left untouched.
        yield* liftResult(this.dataSource.query(
          `INSERT ${this.qualifyType(this.folderType)} {
             path := <str>$path,
             parent := <str>$parent,
             name := <str>$name,
             createdAt := <str>$now,
             updatedAt := <str>$now
           }
           UNLESS CONFLICT ON .path`,
          { path: k, parent, name, now },
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

        // ── Round-trip 1: resolve every key to its full path via parallel SELECTs.
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string; resolved: StoredRow | null }> = [];
          for (const k of cleanKeys) {
            out.push({ key: k, resolved: await this.findFileRow(k) });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<{ key: string; resolved: StoredRow }>;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: ONE EdgeQL `FOR ... UNION (...)` query.
        // Single statement; one transaction. Iterates the unpacked
        // <array<str>> parameter, running DELETE once per element.
        // **The 15th structurally distinct atomic-multi-write
        // mechanism in the Laika suite.**
        if (found.length > 0) {
          const paths = found.map(f => f.resolved.path);
          yield* liftResult(this.dataSource.query(
            `FOR p IN array_unpack(<array<str>>$paths) UNION (
               DELETE ${this.qualifyType(this.fileType)} FILTER .path = p
             )`,
            { paths },
          ));
        }

        for (const f of found) yield* emit.data(f.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`Gel row not found: ${m.key}`));
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
   * Two parallel EdgeQL queries — one per type — with `FILTER .parent =
   * <str>$parent`. Could be one query via a UNION but the two-statement
   * form is clearer.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const parent = stripSlashes(folderKey);
      const fileRows = yield* liftResult(this.dataSource.query<StoredRow>(
        `SELECT ${this.qualifyType(this.fileType)} { id, path, parent, name, extension }
         FILTER .parent = <str>$parent`,
        { parent },
      ));
      const folderRows = yield* liftResult(this.dataSource.query<StoredRow>(
        `SELECT ${this.qualifyType(this.folderType)} { id, path, parent, name }
         FILTER .parent = <str>$parent`,
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
        description: 'Each object is one Gel row of type LaikaFile; the extension is stored in the `extension` property.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over EdgeQL result arrays; native OFFSET/LIMIT pushdown not yet wired.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
