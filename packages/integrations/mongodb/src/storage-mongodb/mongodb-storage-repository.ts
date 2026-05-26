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

import { MongoDataSource, type StorageDoc } from './mongodb-datasource.js';

export interface MongoStorageRepositoryOptions {
  readonly dataSource: MongoDataSource;
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
 * A {@link StorageRepository} backed by a single MongoDB collection.
 *
 * Document model: one row per Laika atom. `_id` encodes the key
 * (`<key>.<ext>` for files, `<key>` for folders); `parent` / `name` /
 * `type` carry the hierarchy fields. The collection is expected to have
 * a compound index on `(type, parent, name)` and a single index on
 * `parent` — neither is created by the repository.
 *
 * Three traits distinguish this backend from the others in the suite:
 *
 *  - **Aggregation pipeline as the listing DSL.** `listAtomSummaries`
 *    dispatches `aggregate([{$match: {parent}}, {$sort: {name:1}}, {$project: {content: 0}}])`
 *    — the `$project: {content: 0}` stage is the load-bearing one, it
 *    suppresses the heavy body field that listings never need. First
 *    backend in the suite to use a multi-stage pipeline DSL.
 *
 *  - **Driver-agnostic.** The repository depends on a structural
 *    `MongoCollectionLike` shape rather than the official `mongodb` driver.
 *    Atlas Data API shims, in-memory mocks, and the native driver all
 *    satisfy it.
 *
 *  - **Single-call `deleteMany` for multi-key removal.** `removeAtoms(N)`
 *    is **one** round-trip: a `findOne` per key is not needed because
 *    `deleteMany({_id: {$in: [...]}})` already short-circuits on missing
 *    documents. The repository resolves keys → ids once via a batch
 *    aggregate so we can report which keys were skipped versus removed.
 */
export class MongoStorageRepository extends StorageRepository {
  private readonly dataSource: MongoDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: MongoStorageRepositoryOptions) {
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

  private fileId(key: string, extension: string): string {
    const { parent, name } = splitPath(this.stripExtension(key));
    return parent === '' ? `${name}.${extension}` : `${parent}/${name}.${extension}`;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const { parent, name } = splitPath(this.stripExtension(key));
        const doc = yield* liftResult(this.dataSource.findFileDoc(parent, name));
        if (!doc) {
          return yield* Effect.fail(new NotFoundError(`MongoDB document not found: ${key}`));
        }
        const extension = doc.extension ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, doc.content ?? ''));
        const callerKey = doc.parent === '' ? doc.name : `${doc.parent}/${doc.name}`;
        return {
          type: 'object',
          key: callerKey,
          createdAt: doc.createdAt ?? new Date(0).toISOString(),
          updatedAt: doc.updatedAt ?? new Date(0).toISOString(),
          content,
          metadata: { extension, revisionId: doc._id },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        if (k === '') {
          const any = yield* liftResult(this.dataSource.hasDescendants(''));
          if (!any) {
            return yield* Effect.fail(new NotFoundError('MongoDB folder not found: <root>'));
          }
          const now = new Date().toISOString();
          return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
        }
        const explicit = yield* liftResult(this.dataSource.findById(k));
        if (explicit && explicit.type === TYPE_FOLDER) {
          return {
            type: 'folder',
            key: k,
            createdAt: explicit.createdAt ?? new Date(0).toISOString(),
            updatedAt: explicit.updatedAt ?? new Date(0).toISOString(),
          } satisfies Folder;
        }
        const implicit = yield* liftResult(this.dataSource.hasDescendants(k));
        if (implicit) {
          const now = new Date().toISOString();
          return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
        }
        return yield* Effect.fail(new NotFoundError(`MongoDB folder not found: ${k}`));
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const { parent, name } = splitPath(this.stripExtension(key));
        const doc = yield* liftResult(this.dataSource.findFileDoc(parent, name));
        if (doc) return yield* LaikaTask.runValue(this.getObject(key));
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

        const existing = yield* liftResult(this.dataSource.findFileDoc(parent, name));
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
        const now = new Date().toISOString();

        yield* liftResult(this.dataSource.insertOne({
          _id: this.fileId(create.key, extension),
          type: TYPE_FILE,
          parent,
          name,
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
        const { parent, name } = splitPath(this.stripExtension(update.key));
        const existing = yield* liftResult(this.dataSource.findFileDoc(parent, name));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`MongoDB document not found: ${update.key}`));
        }
        if (update.content) {
          const extension = existing.extension ?? this.defaultFileExtension;
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          yield* liftResult(this.dataSource.upsert({
            ...existing,
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
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const existing = yield* liftResult(this.dataSource.findFileDoc(parent, name));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const now = new Date().toISOString();
        yield* liftResult(this.dataSource.upsert({
          _id: this.fileId(create.key, extension),
          type: TYPE_FILE,
          parent,
          name,
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
        const existing = yield* liftResult(this.dataSource.findById(k));
        const now = new Date().toISOString();
        if (!existing) {
          yield* liftResult(this.dataSource.insertOne({
            _id: k,
            type: TYPE_FOLDER,
            parent,
            name,
            createdAt: now,
            updatedAt: now,
          }));
        }
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
            yield* emit.recoverableError(new BadRequestError(`Refusing to delete empty key`));
          }
          return { removed: 0, skipped: skipped0 };
        }

        // ── Round-trip 1: resolve every key to its _id via a single `findOne`
        //    per key. (Mongo doesn't have a single batch lookup that returns
        //    rows in the same order we asked.) We use Promise.all so it's
        //    one observable wall-clock round trip's worth of latency, but
        //    technically N driver calls.
        const docs = yield* Effect.promise(async () => {
          const results = await Promise.all(cleanKeys.map(async k => {
            const { parent, name } = splitPath(this.stripExtension(k));
            const r = await this.dataSource.findFileDoc(parent, name);
            return { key: k, doc: Result.isSuccess(r) ? r.success : null };
          }));
          return results;
        });

        const foundIds = docs.filter(d => d.doc !== null).map(d => d.doc!._id);

        // ── Round-trip 2: one `deleteMany({_id: {$in: [...]}})` — atomic,
        //    independent of N.
        if (foundIds.length > 0) {
          yield* liftResult(this.dataSource.deleteByIds(foundIds));
        }

        let removed = 0;
        let skipped = skipped0;
        for (const { key, doc } of docs) {
          if (!doc) {
            yield* emit.recoverableError(new NotFoundError(`MongoDB document not found: ${key}`));
            skipped += 1;
          } else {
            const callerKey = doc.parent === '' ? doc.name : `${doc.parent}/${doc.name}`;
            yield* emit.data(callerKey);
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
   * The aggregation pipeline does the work. `$project: {content: 0}` is
   * the load-bearing stage — it strips the heavy content field from
   * listing results, so a folder of 10k 50KB documents stays bounded.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const parent = stripSlashes(folderKey);
      const docs = yield* liftResult(this.dataSource.aggregateChildren(parent));
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
          'Each object is one MongoDB document with the extension stored in `extension` and encoded in `_id`.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description:
          'In-memory slicing over aggregation pipeline output; native `$skip`/`$limit` are not yet pushed down.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
