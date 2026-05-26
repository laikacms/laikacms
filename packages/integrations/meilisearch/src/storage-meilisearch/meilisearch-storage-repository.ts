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

import { andFilter, eqFilter, type MeiliDataSource, type MeiliDocument } from './meilisearch-datasource.js';

export interface MeiliStorageRepositoryOptions {
  readonly dataSource: MeiliDataSource;
  /** Index name. Default `laika_storage`. */
  readonly indexUid?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_INDEX = 'laika_storage';

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

const validateIndexUid = (name: string): void => {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new BadRequestError(`Invalid MeiliSearch index UID: ${name}`);
  }
};

/**
 * A {@link StorageRepository} backed by a single MeiliSearch index.
 * Documents have:
 *
 *     id: <type>:<path>       (the primary key — `file:notes/hello.md` or `folder:notes`)
 *     type: 'file' | 'folder'
 *     parent: <parent-path>
 *     name: <leaf-name>
 *     extension?: string
 *     content?: string
 *     createdAt, updatedAt
 *
 * Five MeiliSearch-specific behaviours shape the wire format:
 *
 *  - **Tasks API**. Every write returns a task uid; the data source
 *    auto-polls until success. The repository's contract methods
 *    `await` as usual, but the async-by-default model lives inside
 *    `mutateAndAwait` at the data-source layer.
 *
 *  - **Bulk delete via primary-key array**. `removeAtoms(N)` ships as
 *    one POST to `/documents/delete-batch` with `[id1, id2, …, idN]`
 *    body. **The 16th structurally distinct atomic-multi-write
 *    mechanism in the Laika suite.**
 *
 *  - **SQL-like filter DSL** — `parent = "notes" AND type = "file"`.
 *    The `eqFilter` / `andFilter` helpers build these.
 *
 *  - **Search via POST body** — `POST /indexes/{name}/search` with
 *    `{filter, limit}`.
 *
 *  - **Index initialisation up front** — the repository's first call
 *    issues `POST /indexes` with the primary key + filterable attrs.
 *    Subsequent calls skip this via cached state.
 */
export class MeiliStorageRepository extends StorageRepository {
  private readonly dataSource: MeiliDataSource;
  private readonly indexUid: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;
  private indexEnsured = false;

  constructor(options: MeiliStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      indexUid = DEFAULT_INDEX,
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    validateIndexUid(indexUid);
    this.dataSource = dataSource;
    this.indexUid = indexUid;
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

  /**
   * Ensure the index exists with the expected primary key + filterable
   * attributes. Idempotent — called once per data-source lifetime then
   * cached.
   */
  private async ensureIndex(): Promise<LaikaResult<void>> {
    if (this.indexEnsured) return Result.succeed(undefined);
    const created = await this.dataSource.ensureIndex(this.indexUid, 'id');
    if (Result.isFailure(created)) return Result.fail(created.failure);
    const filterable = await this.dataSource.updateFilterableAttributes(
      this.indexUid,
      ['type', 'parent', 'name', 'extension'],
    );
    if (Result.isFailure(filterable)) return Result.fail(filterable.failure);
    this.indexEnsured = true;
    return Result.succeed(undefined);
  }

  private fileId(path: string): string {
    return `file:${path}`;
  }

  private folderId(path: string): string {
    return `folder:${path}`;
  }

  private filePath(key: string, extension: string): string {
    const stripped = stripSlashes(this.stripExtension(key));
    return `${stripped}.${extension}`;
  }

  /**
   * Resolve an extension-free key to its file document via search with a
   * SQL-like filter:
   *
   *     POST /indexes/{uid}/search  { filter: 'type = "file" AND parent = "notes" AND name = "hello"', limit: 1 }
   */
  private async findFileDoc(key: string): Promise<MeiliDocument | null> {
    await this.ensureIndex();
    const { parent, name } = splitPath(this.stripExtension(key));
    const filter = andFilter(
      eqFilter('type', TYPE_FILE),
      eqFilter('parent', parent),
      eqFilter('name', name),
    );
    const r = await this.dataSource.search(this.indexUid, { filter, limit: 1 });
    if (Result.isFailure(r)) return null;
    return r.success.hits[0] ?? null;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const doc = yield* Effect.promise(() => this.findFileDoc(key));
        if (!doc) {
          return yield* Effect.fail(new NotFoundError(`MeiliSearch file not found: ${key}`));
        }
        const extension = doc.extension ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, doc.content ?? ''));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: doc.createdAt ?? new Date(0).toISOString(),
          updatedAt: doc.updatedAt ?? new Date(0).toISOString(),
          content,
          // Primary key IS the revision identifier here — it stays stable
          // across content updates, but the timestamp changes.
          metadata: { extension, revisionId: doc.updatedAt ?? doc.id },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.ensureIndex());
        const k = stripSlashes(key);
        if (k === '') {
          const probe = yield* liftResult(this.dataSource.search(this.indexUid, { limit: 1 }));
          if (probe.hits.length === 0) {
            return yield* Effect.fail(new NotFoundError('MeiliSearch root folder is empty'));
          }
          const now = new Date().toISOString();
          return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
        }
        // Explicit folder doc?
        const explicit = yield* liftResult(this.dataSource.getDocument(
          this.indexUid,
          this.folderId(k),
        ));
        if (explicit) {
          return {
            type: 'folder',
            key: k,
            createdAt: explicit.createdAt ?? new Date(0).toISOString(),
            updatedAt: explicit.updatedAt ?? new Date(0).toISOString(),
          } satisfies Folder;
        }
        // Implicit folder — any descendant?
        const childProbe = yield* liftResult(this.dataSource.search(this.indexUid, {
          filter: eqFilter('parent', k),
          limit: 1,
        }));
        if (childProbe.hits.length > 0) {
          const now = new Date().toISOString();
          return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
        }
        return yield* Effect.fail(new NotFoundError(`MeiliSearch folder not found: ${k}`));
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const file = yield* Effect.promise(() => this.findFileDoc(key));
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
        yield* liftResult(this.ensureIndex());
        const existing = yield* Effect.promise(() => this.findFileDoc(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${
                existing.extension ?? this.defaultFileExtension
              }`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const fullPath = this.filePath(create.key, extension);
        const now = new Date().toISOString();
        yield* liftResult(this.dataSource.upsertDocuments(this.indexUid, [{
          id: this.fileId(fullPath),
          type: TYPE_FILE,
          parent,
          name,
          extension,
          content: serialized,
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
        const existing = yield* Effect.promise(() => this.findFileDoc(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`MeiliSearch file not found: ${update.key}`));
        }
        if (update.content) {
          const extension = existing.extension ?? this.defaultFileExtension;
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          // PUT documents upserts by primary key.
          yield* liftResult(this.dataSource.upsertDocuments(this.indexUid, [{
            ...existing,
            content: serialized,
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
        yield* liftResult(this.ensureIndex());
        const existing = yield* Effect.promise(() => this.findFileDoc(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const fullPath = existing
          ? (existing.id.startsWith('file:') ? existing.id.slice(5) : this.filePath(create.key, extension))
          : this.filePath(create.key, extension);
        const now = new Date().toISOString();
        yield* liftResult(this.dataSource.upsertDocuments(this.indexUid, [{
          id: this.fileId(fullPath),
          type: TYPE_FILE,
          parent,
          name,
          extension,
          content: serialized,
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
        yield* liftResult(this.ensureIndex());
        const k = stripSlashes(folderCreate.key);
        if (k === '') return yield* LaikaTask.runValue(this.getFolder(''));
        const { parent, name } = splitPath(k);
        const now = new Date().toISOString();
        // Upsert — idempotent.
        yield* liftResult(this.dataSource.upsertDocuments(this.indexUid, [{
          id: this.folderId(k),
          type: TYPE_FOLDER,
          parent,
          name,
          createdAt: now,
          updatedAt: now,
        }]));
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

  /**
   * **The load-bearing distinctive behaviour**: `removeAtoms(N)` ships
   * as ONE POST to `/indexes/{uid}/documents/delete-batch` with the
   * full primary-key array. Returns one task uid; the data source
   * polls until the batch commits.
   *
   * **The 16th structurally distinct atomic-multi-write mechanism in
   * the Laika suite** — async-bulk-operation completed via task
   * polling.
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

        // ── Round-trip 1: resolve every key to its document.
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string, resolved: MeiliDocument | null }> = [];
          for (const k of cleanKeys) {
            out.push({ key: k, resolved: await this.findFileDoc(k) });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<{ key: string, resolved: MeiliDocument }>;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: ONE bulk-delete POST with the ID array.
        // The data source's `mutateAndAwait` blocks on the task uid
        // until the batch succeeds.
        if (found.length > 0) {
          const ids = found.map(f => f.resolved.id);
          yield* liftResult(this.dataSource.deleteDocumentsBatch(this.indexUid, ids));
        }

        for (const f of found) yield* emit.data(f.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`MeiliSearch file not found: ${m.key}`));
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

  /** Single search call with filter on `parent`. */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      yield* liftResult(this.ensureIndex());
      const parent = stripSlashes(folderKey);
      const result = yield* liftResult(this.dataSource.search(this.indexUid, {
        filter: eqFilter('parent', parent),
        limit: 1000,
      }));
      const callerPrefix = parent === '' ? '' : `${parent}/`;
      const summaries: AtomSummary[] = result.hits.map(hit => {
        const isFile = hit.type === TYPE_FILE;
        return isFile
          ? { type: 'object-summary', key: callerPrefix + hit.name }
          : { type: 'folder-summary', key: callerPrefix + hit.name };
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
        description: 'Each object is one MeiliSearch document with `type=file` and the extension in a separate field.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over search results; MeiliSearch native offset/limit not yet pushed down.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
