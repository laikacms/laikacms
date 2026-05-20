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

import type { ConvexDataSource } from './convex-datasource.js';

/**
 * Names of the Convex functions the repository invokes. Users override
 * these to use their own module/function names. Defaults assume the
 * reference `convex/laika.ts` module from the README.
 */
export interface ConvexFunctionPaths {
  /** `query` — returns `{path, parent, name, extension, content, createdAt, updatedAt, _id} | null`. */
  readonly getFile?: string;
  /** `query` — returns array of `{path, parent, name, extension, content?, type, ...}`. */
  readonly listChildren?: string;
  /** `query` — returns `{path, parent, name, createdAt, updatedAt, _id} | null`. */
  readonly getFolder?: string;
  /** `query` — returns `boolean`. */
  readonly hasDescendants?: string;
  /** `mutation` — returns the created file row. Throws on duplicate. */
  readonly createFile?: string;
  /** `mutation` — returns the updated file row. */
  readonly updateFile?: string;
  /** `mutation` — returns the upserted file row. */
  readonly upsertFile?: string;
  /** `mutation` — returns `{removed: string[], missing: string[]}`. */
  readonly removeFiles?: string;
  /** `mutation` — returns the (newly-created or existing) folder row. */
  readonly upsertFolder?: string;
}

const DEFAULT_FUNCTION_PATHS: Required<ConvexFunctionPaths> = {
  getFile: 'laika:getFile',
  listChildren: 'laika:listChildren',
  getFolder: 'laika:getFolder',
  hasDescendants: 'laika:hasDescendants',
  createFile: 'laika:createFile',
  updateFile: 'laika:updateFile',
  upsertFile: 'laika:upsertFile',
  removeFiles: 'laika:removeFiles',
  upsertFolder: 'laika:upsertFolder',
};

export interface ConvexStorageRepositoryOptions {
  readonly dataSource: ConvexDataSource;
  readonly functions?: ConvexFunctionPaths;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

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

interface ConvexFileRow {
  _id: string;
  _creationTime?: number;
  path: string;
  parent: string;
  name: string;
  extension?: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ConvexFolderRow {
  _id: string;
  _creationTime?: number;
  path: string;
  parent: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ConvexChildRow {
  _id: string;
  type: 'file' | 'folder';
  path: string;
  parent: string;
  name: string;
  extension?: string;
}

/**
 * A {@link StorageRepository} backed by Convex via the HTTP RPC endpoint.
 * Unlike every prior backend in the suite, the "query language" is
 * server-side TypeScript functions defined in the user's Convex project.
 * The package's value is the wire-shape adapter and the standardised
 * function-contract.
 *
 * Three idioms shape the wire format:
 *
 *  - **Named-function RPC.** Each contract method maps to one named
 *    Convex function. `getObject(key)` invokes `laika:getFile`;
 *    `removeAtoms(N)` invokes `laika:removeFiles` with the full path
 *    array. The user's Convex function does the database work and
 *    returns a typed result.
 *
 *  - **Transactional mutations.** Convex mutations are
 *    deterministic and transactional. The `removeAtoms` flow lives
 *    entirely inside one mutation call — the user's function loops
 *    over the path array and calls `ctx.db.delete()` in one
 *    transaction. Atomicity at the function boundary, not the wire
 *    protocol.
 *
 *  - **Reference function contract.** Users copy a reference TypeScript
 *    module (`convex/laika.ts`, shown in the README) into their
 *    project. The function signatures are stable; the repository
 *    promises to invoke them with the documented arg shapes and
 *    consume the documented return shapes.
 *
 * `removeAtoms(N)` ships as ONE mutation call with the path array as a
 * parameter. The user's `removeFiles` function returns
 * `{removed: string[], missing: string[]}` so the repository can
 * partition successes from skipped keys at the application layer.
 */
export class ConvexStorageRepository extends StorageRepository {
  private readonly dataSource: ConvexDataSource;
  private readonly functions: Required<ConvexFunctionPaths>;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: ConvexStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      functions = {},
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    this.dataSource = dataSource;
    this.functions = { ...DEFAULT_FUNCTION_PATHS, ...functions };
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
   * Resolve an extension-free key to its row via one query call. The
   * user's `laika:getFile` function looks the row up by `(parent, name)`
   * and returns it (or `null`).
   */
  private async findFileRow(key: string): Promise<ConvexFileRow | null> {
    const { parent, name } = splitPath(this.stripExtension(key));
    const r = await this.dataSource.query<ConvexFileRow | null>(this.functions.getFile, { parent, name });
    if (Result.isFailure(r)) return null;
    return r.success;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const row = yield* Effect.promise(() => this.findFileRow(key));
        if (!row) {
          return yield* Effect.fail(new NotFoundError(`Convex file not found: ${key}`));
        }
        const extension = row.extension ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, row.content ?? ''));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: row.createdAt ?? new Date(row._creationTime ?? 0).toISOString(),
          updatedAt: row.updatedAt ?? row.createdAt ?? new Date(row._creationTime ?? 0).toISOString(),
          content,
          // Convex auto-generates `_id` (a short opaque ID) — surface as revisionId.
          metadata: { extension, revisionId: row._id },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        if (k === '') {
          // Root — succeed if anything exists in the deployment. Use hasDescendants(parent='')
          // to probe.
          const any = yield* liftResult(this.dataSource.query<boolean>(this.functions.hasDescendants, { parent: '' }));
          if (!any) {
            return yield* Effect.fail(new NotFoundError('Convex root folder is empty'));
          }
          const now = new Date().toISOString();
          return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
        }
        const explicit = yield* liftResult(this.dataSource.query<ConvexFolderRow | null>(
          this.functions.getFolder, { path: k },
        ));
        if (explicit) {
          return {
            type: 'folder',
            key: k,
            createdAt: explicit.createdAt ?? new Date(explicit._creationTime ?? 0).toISOString(),
            updatedAt: explicit.updatedAt ?? new Date(explicit._creationTime ?? 0).toISOString(),
          } satisfies Folder;
        }
        // Implicit folder — any descendant?
        const implicit = yield* liftResult(this.dataSource.query<boolean>(
          this.functions.hasDescendants, { parent: k },
        ));
        if (implicit) {
          const now = new Date().toISOString();
          return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
        }
        return yield* Effect.fail(new NotFoundError(`Convex folder not found: ${k}`));
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
        const now = new Date().toISOString();
        yield* liftResult(this.dataSource.mutation(this.functions.createFile, {
          path: this.filePath(create.key, extension),
          parent, name,
          extension,
          content: serialized,
          createdAt: now,
          updatedAt: now,
        }));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileRow(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`Convex file not found: ${update.key}`));
        }
        if (update.content) {
          const extension = existing.extension ?? this.defaultFileExtension;
          const serialized = yield* Effect.promise(() =>
            this.serialize(extension, update.content!),
          );
          yield* liftResult(this.dataSource.mutation(this.functions.updateFile, {
            path: existing.path,
            content: serialized,
            updatedAt: new Date().toISOString(),
          }));
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
        const now = new Date().toISOString();
        yield* liftResult(this.dataSource.mutation(this.functions.upsertFile, {
          path: this.filePath(create.key, extension),
          parent, name,
          extension,
          content: serialized,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }));
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
        yield* liftResult(this.dataSource.mutation(this.functions.upsertFolder, {
          path: k, parent, name,
          createdAt: now, updatedAt: now,
        }));
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

  /**
   * `removeAtoms(N)` ships as ONE mutation call with the full path array.
   * The user's `laika:removeFiles` function processes the array inside
   * one transaction and returns `{removed: string[], missing: string[]}`.
   *
   * The "atomic" lives in the Convex function's transactional execution,
   * not in a new wire-protocol mechanism. Compare with prior mechanisms:
   *
   *   - SurrealDB / Cypher: client supplies the multi-statement query text
   *   - libSQL: client supplies the conditional batch shape
   *   - **Convex (this)**: client supplies the array; the user-written
   *     function defines the iteration. The wire shape is just RPC.
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
          const out: Array<{ key: string; resolved: ConvexFileRow | null }> = [];
          for (const k of cleanKeys) {
            out.push({ key: k, resolved: await this.findFileRow(k) });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<{ key: string; resolved: ConvexFileRow }>;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: ONE mutation call with the path array. The
        // user's `laika:removeFiles` function iterates and deletes
        // inside one Convex transaction.
        if (found.length > 0) {
          const paths = found.map(f => f.resolved.path);
          yield* liftResult(this.dataSource.mutation<{ removed: string[]; missing: string[] }>(
            this.functions.removeFiles, { paths },
          ));
        }

        for (const f of found) yield* emit.data(f.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`Convex file not found: ${m.key}`));
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

  /** One `query` call to `laika:listChildren` — returns mixed files + folders. */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const parent = stripSlashes(folderKey);
      const rows = yield* liftResult(this.dataSource.query<ConvexChildRow[]>(
        this.functions.listChildren, { parent },
      ));
      const callerPrefix = parent === '' ? '' : `${parent}/`;
      const summaries: AtomSummary[] = rows.map((row) => {
        return row.type === 'file'
          ? { type: 'object-summary', key: callerPrefix + row.name }
          : { type: 'folder-summary', key: callerPrefix + row.name };
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
        description: 'Each object is one row in the Convex `laika_files` table; the extension is stored in the `extension` field.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over Convex query result arrays; native cursor pagination not yet wired.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
