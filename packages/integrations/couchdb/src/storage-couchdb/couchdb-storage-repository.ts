import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  InternalError,
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
import * as minimatch from 'minimatch';

import { CouchDbDataSource, type StorageDoc } from './couchdb-datasource.js';

export interface CouchDbStorageRepositoryOptions {
  readonly dataSource: CouchDbDataSource;
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

/**
 * A {@link StorageRepository} backed by [Apache CouchDB](https://docs.couchdb.org/)
 * (also speaks to IBM Cloudant and any CouchDB-protocol-compatible store).
 *
 * Each Laika object becomes one CouchDB document; each Laika folder becomes
 * one CouchDB document with `type: 'folder'`. The doc id encodes the key
 * (with file extension for objects), and a `parent` field stores the
 * containing folder path. Listing children is a single Mango query:
 *
 *     POST /db/_find  {selector: {parent: 'notes'}}
 *
 * The interesting traits of this backend:
 *
 *  - **First-class revisions.** Every document carries `_rev`. Updates must
 *    pass the current `_rev`; CouchDB returns **409 Conflict** when stale.
 *    The repository surfaces 409 as `EntryAlreadyExistsError` on create and
 *    as a recoverable conflict in `removeAtoms`.
 *
 *  - **`POST /_bulk_docs` for multi-key writes.** `removeAtoms(N)` is two
 *    round-trips regardless of N: one `POST /_find` to resolve every key's
 *    `(_id, _rev)` pair, then one `POST /_bulk_docs` with all `_deleted: true`
 *    markers. The bulk endpoint reports per-doc success / conflict — so
 *    `removed` and `skipped` come from inspecting the response array, not
 *    just the HTTP status.
 */
export class CouchDbStorageRepository extends StorageRepository {
  private readonly dataSource: CouchDbDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: CouchDbStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

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

  /**
   * Find the live file doc for an extension-free key. Single Mango query —
   * CouchDB returns the full doc (with `_rev` and `content`) inline, so a
   * second `GET` is never needed.
   */
  private async findFileDoc(key: string): Promise<StorageDoc | null> {
    const { parent, name } = splitPath(this.stripExtension(stripSlashes(key)));
    const result = await this.dataSource.find<StorageDoc>({
      selector: { type: TYPE_FILE, parent, name },
      limit: 1,
    });
    if (Result.isFailure(result)) return null;
    return result.success[0] ?? null;
  }

  /** Mango selector for a single file doc by extension-free key. */
  private fileSelector(key: string): Record<string, unknown> {
    const { parent, name } = splitPath(this.stripExtension(stripSlashes(key)));
    return { type: TYPE_FILE, parent, name };
  }

  /** Existence probe for a folder — either an explicit doc, or any descendant. */
  private async hasFolder(key: string): Promise<boolean> {
    const k = stripSlashes(key);
    if (k === '') {
      // Root folder always exists if anything exists.
      const r = await this.dataSource.find<StorageDoc>({ selector: {}, limit: 1 });
      if (Result.isFailure(r)) return false;
      return r.success.length > 0;
    }
    // Either a folder doc, or any descendant.
    const r = await this.dataSource.find<StorageDoc>({
      selector: { $or: [{ _id: k, type: TYPE_FOLDER }, { parent: k }] },
      limit: 1,
    });
    if (Result.isFailure(r)) return false;
    return r.success.length > 0;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const doc = yield* Effect.promise(() => this.findFileDoc(key));
        if (!doc) {
          return yield* Effect.fail(new NotFoundError(`CouchDB document not found: ${key}`));
        }
        const extension = doc.extension ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, doc.content ?? ''));
        const callerKey = doc.parent === '' ? doc.name : `${doc.parent}/${doc.name}`;
        const now = new Date().toISOString();
        return {
          type: 'object',
          key: callerKey,
          createdAt: now,
          updatedAt: now,
          content,
          metadata: { extension, revisionId: doc._rev },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const exists = yield* Effect.promise(() => this.hasFolder(key));
        if (!exists) {
          return yield* Effect.fail(new NotFoundError(`CouchDB folder not found: ${key || '<root>'}`));
        }
        const now = new Date().toISOString();
        return { type: 'folder', key, createdAt: now, updatedAt: now } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const doc = yield* Effect.promise(() => this.findFileDoc(key));
        if (doc) return yield* LaikaTask.runValue(this.getObject(key));
        const isDir = yield* Effect.promise(() => this.hasFolder(key));
        if (isDir) return yield* LaikaTask.runValue(this.getFolder(key));
        return yield* Effect.fail(new BadRequestError(`Path not found: ${key}`));
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required for creation'));
        }
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
        const id = parent === '' ? `${name}.${extension}` : `${parent}/${name}.${extension}`;
        const doc: StorageDoc = {
          _id: id,
          _rev: '',
          type: TYPE_FILE,
          parent,
          name,
          extension,
          content: serialized,
        };
        // PUT without _rev on a non-existent doc creates it; with _rev mismatch returns 409.
        const putResult = yield* liftResult(this.dataSource.put({ ...doc, _rev: undefined as unknown as string }));
        void putResult;
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileDoc(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`CouchDB document not found: ${update.key}`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() =>
            this.serialize(existing.extension ?? this.defaultFileExtension, update.content!)
          );
          const updated: StorageDoc = {
            ...existing,
            content: serialized,
          };
          yield* liftResult(this.dataSource.put(updated));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileDoc(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        if (existing) {
          yield* liftResult(this.dataSource.put({ ...existing, content: serialized }));
        } else {
          const { parent, name } = splitPath(this.stripExtension(create.key));
          const id = parent === '' ? `${name}.${extension}` : `${parent}/${name}.${extension}`;
          yield* liftResult(this.dataSource.put({
            _id: id,
            _rev: undefined as unknown as string,
            type: TYPE_FILE,
            parent,
            name,
            extension,
            content: serialized,
          }));
        }
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(folderCreate.key);
        if (k === '') {
          // Root has no doc; consider it always present.
          return yield* LaikaTask.runValue(this.getFolder(''));
        }
        const { parent, name } = splitPath(k);
        // Check for an existing folder doc first.
        const head = yield* liftResult(this.dataSource.head(k));
        if (head !== null) {
          return yield* LaikaTask.runValue(this.getFolder(k));
        }
        yield* liftResult(this.dataSource.put({
          _id: k,
          _rev: undefined as unknown as string,
          type: TYPE_FOLDER,
          parent,
          name,
        }));
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const k = keys.map(s => stripSlashes(s)).filter(s => s !== '');
        if (k.length === 0) return { removed: 0, skipped: keys.length };

        // ── Round-trip 1: resolve every key's (_id, _rev) via one Mango find ──
        const selectors = k.map(key => this.fileSelector(key));
        const finds = yield* liftResult(this.dataSource.find<StorageDoc>({
          selector: selectors.length === 1 ? selectors[0]! : { $or: selectors },
          limit: k.length + 16,
        }));

        // Build (originalKey → doc) map. Missing keys are skipped.
        const docsByKey = new Map<string, StorageDoc>();
        for (const doc of finds) {
          const callerKey = doc.parent === '' ? doc.name : `${doc.parent}/${doc.name}`;
          docsByKey.set(callerKey, doc);
        }

        // ── Round-trip 2: one _bulk_docs DELETE for every resolved doc ──
        const toDelete = k.flatMap(key => {
          const d = docsByKey.get(stripSlashes(this.stripExtension(key)));
          return d ? [{ _id: d._id, _rev: d._rev, _deleted: true }] : [];
        });
        if (toDelete.length > 0) {
          const bulkResult = yield* liftResult(this.dataSource.bulkDocs(toDelete));
          // CouchDB returns per-doc results — conflicts are reported here, not via HTTP status.
          for (const entry of bulkResult) {
            if (entry.error) {
              yield* emit.recoverableError(
                new InternalError(`CouchDB bulk-delete conflict for ${entry.id}: ${entry.reason ?? entry.error}`),
              );
            }
          }
        }

        let removed = 0;
        let skipped = 0;
        for (const key of k) {
          const stripped = stripSlashes(this.stripExtension(key));
          const doc = docsByKey.get(stripped);
          if (!doc) {
            yield* emit.recoverableError(new NotFoundError(`CouchDB document not found: ${key}`));
            skipped += 1;
            continue;
          }
          yield* emit.data(stripped);
          removed += 1;
        }
        return { removed, skipped: skipped + (keys.length - k.length) };
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

  /** Single Mango query on `parent`. */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const parent = stripSlashes(folderKey);
      const docs = yield* liftResult(this.dataSource.find<StorageDoc>({
        selector: { parent },
        limit: 1000,
      }));
      const summaries: AtomSummary[] = docs.map(doc => {
        const callerKey = doc.parent === '' ? doc.name : `${doc.parent}/${doc.name}`;
        return doc.type === TYPE_FILE
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
          'Each object is one CouchDB document with the extension stored in `extension` and encoded in `_id`.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over Mango `POST /_find` responses; CouchDB bookmarks not surfaced.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
