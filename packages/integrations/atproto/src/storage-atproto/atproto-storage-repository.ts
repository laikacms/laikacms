import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  InternalError,
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

import {
  type ApplyWritesAction,
  type AtprotoDataSource,
  type AtprotoRecord,
  pathToRkey,
  rkeyToPath,
} from './atproto-datasource.js';

export interface AtprotoStorageRepositoryOptions {
  readonly dataSource: AtprotoDataSource;
  /**
   * Lexicon name for file records. Default `com.laikacms.file`.
   * Self-hosted PDSes accept any NSID; Bluesky's PDS warns on unknown
   * lexicons but still stores them.
   */
  readonly fileCollection?: string;
  /** Lexicon name for folder records. Default `com.laikacms.folder`. */
  readonly folderCollection?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_FILE_COLLECTION = 'com.laikacms.file';
const DEFAULT_FOLDER_COLLECTION = 'com.laikacms.folder';

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

const splitPath = (key: string): { parent: string, name: string } => {
  const k = stripSlashes(key);
  const last = k.lastIndexOf('/');
  if (last === -1) return { parent: '', name: k };
  return { parent: k.slice(0, last), name: k.slice(last + 1) };
};

/** Shape we write into the record `value` field. */
interface StoredAtomValue extends Record<string, unknown> {
  $type: string;
  path: string;
  parent: string;
  name: string;
  extension?: string;
  content?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A {@link StorageRepository} backed by an AT Protocol repo on a PDS
 * (Personal Data Server). Records live in two custom collections:
 *
 *   - `com.laikacms.file`   — one record per Laika file, rkey = `path:with:colons.ext`
 *   - `com.laikacms.folder` — one record per Laika folder, rkey = `path:with:colons`
 *
 * Both collection names are configurable.
 *
 * Three traits set this backend apart from everything before:
 *
 *  - **Content-addressable.** Every record has a CID — a SHA-256-based
 *    hash of the canonicalised CBOR encoding. The CID changes on every
 *    update, surfacing as `metadata.revisionId`. **First
 *    content-addressable backend in the suite.** Other backends had
 *    monotonic counters (etcd), ETags (S3, OneDrive), or document revs
 *    (CouchDB); none of those are content hashes.
 *
 *  - **DID-based repo identity.** No "database name", no "bucket id" —
 *    the entire repo *is* a DID like `did:plc:abc...`. Multi-tenancy
 *    falls out for free: every tenant has their own DID.
 *
 *  - **`applyWrites` with discriminated-union actions.** `removeAtoms(N)`
 *    ships as one `applyWrites` call with N
 *    `com.atproto.repo.applyWrites#delete` actions. Atomic at the repo
 *    level — partial failures roll back. **The 11th structurally
 *    distinct atomic-multi-write mechanism in the suite.**
 */
export class AtprotoStorageRepository extends StorageRepository {
  private readonly dataSource: AtprotoDataSource;
  private readonly fileCollection: string;
  private readonly folderCollection: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: AtprotoStorageRepositoryOptions) {
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

  /**
   * Resolve an extension-free key to its `(record, extension)` pair by
   * trying each known serializer extension in parallel. Each is a single
   * `getRecord` round-trip; we resolve in parallel so wall-clock latency
   * is one round-trip's worth.
   */
  private async resolveFile(
    key: string,
  ): Promise<{ record: AtprotoRecord<StoredAtomValue>, extension: string } | null> {
    const base = this.stripExtension(stripSlashes(key));
    const rkeyBase = pathToRkey(base);
    const probes = await Promise.all(
      this.availableExtensions.map(async ext => {
        const rkey = `${rkeyBase}.${ext}`;
        const r = await this.dataSource.getRecord<StoredAtomValue>(this.fileCollection, rkey);
        return Result.isSuccess(r) && r.success !== null ? { record: r.success, extension: ext } : null;
      }),
    );
    return probes.find(p => p !== null) ?? null;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolveFile(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`AT Protocol record not found: ${key}`));
        }
        const v = resolved.record.value;
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, v.content ?? ''));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: v.createdAt ?? new Date(0).toISOString(),
          updatedAt: v.updatedAt ?? new Date(0).toISOString(),
          content,
          // CID — content-addressable revision. First backend where revisionId
          // is genuinely a content hash, not a counter or ETag.
          metadata: { extension: resolved.extension, revisionId: resolved.record.cid },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        if (k === '') {
          // Root: any record in either collection means root exists.
          const probe = yield* liftResult(this.dataSource.listRecords(this.fileCollection, { limit: 1 }));
          if (probe.records.length > 0) {
            const now = new Date().toISOString();
            return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
          }
          const folderProbe = yield* liftResult(this.dataSource.listRecords(this.folderCollection, { limit: 1 }));
          if (folderProbe.records.length > 0) {
            const now = new Date().toISOString();
            return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
          }
          return yield* Effect.fail(new NotFoundError('AT Protocol root folder is empty'));
        }
        const rkey = pathToRkey(k);
        const explicit = yield* liftResult(
          this.dataSource.getRecord<StoredAtomValue>(this.folderCollection, rkey),
        );
        if (explicit) {
          return {
            type: 'folder',
            key: k,
            createdAt: explicit.value.createdAt ?? new Date(0).toISOString(),
            updatedAt: explicit.value.updatedAt ?? new Date(0).toISOString(),
          } satisfies Folder;
        }
        // Implicit folder — any descendant under `rkey:` prefix?
        const childProbe = yield* liftResult(this.dataSource.listRecords(this.fileCollection, {
          rkeyStart: `${rkey}:`,
          rkeyEnd: `${rkey};`, // `;` is the next ASCII char after `:`
          limit: 1,
        }));
        if (childProbe.records.length > 0) {
          const now = new Date().toISOString();
          return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
        }
        return yield* Effect.fail(new NotFoundError(`AT Protocol folder not found: ${k}`));
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const file = yield* Effect.promise(() => this.resolveFile(key));
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
        const existing = yield* Effect.promise(() => this.resolveFile(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const k = stripSlashes(this.stripExtension(create.key));
        const rkey = `${pathToRkey(k)}.${extension}`;
        const now = new Date().toISOString();
        const value: StoredAtomValue = {
          $type: this.fileCollection,
          path: k,
          parent,
          name,
          extension,
          content: serialized,
          createdAt: now,
          updatedAt: now,
        };
        yield* liftResult(this.dataSource.createRecord(this.fileCollection, rkey, value));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveFile(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`AT Protocol record not found: ${update.key}`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension, update.content!));
          const k = stripSlashes(this.stripExtension(update.key));
          const rkey = `${pathToRkey(k)}.${existing.extension}`;
          const newValue: StoredAtomValue = {
            ...existing.record.value,
            content: serialized,
            updatedAt: new Date().toISOString(),
          };
          // Use swapRecord with the prior CID for CAS — if a concurrent
          // writer beat us, the PDS rejects the put with InvalidSwap.
          yield* liftResult(this.dataSource.putRecord(
            this.fileCollection,
            rkey,
            newValue,
            { swapRecord: existing.record.cid },
          ));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveFile(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const k = stripSlashes(this.stripExtension(create.key));
        const rkey = `${pathToRkey(k)}.${extension}`;
        const now = new Date().toISOString();
        const value: StoredAtomValue = {
          $type: this.fileCollection,
          path: k,
          parent,
          name,
          extension,
          content: serialized,
          createdAt: existing?.record.value.createdAt ?? now,
          updatedAt: now,
        };
        yield* liftResult(this.dataSource.putRecord(this.fileCollection, rkey, value));
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
        const rkey = pathToRkey(k);
        const existing = yield* liftResult(this.dataSource.getRecord(this.folderCollection, rkey));
        const now = new Date().toISOString();
        if (!existing) {
          const value: StoredAtomValue = {
            $type: this.folderCollection,
            path: k,
            parent,
            name,
            createdAt: now,
            updatedAt: now,
          };
          // Use putRecord (not createRecord) for idempotency — if a race
          // creates the same folder twice, both succeed with the same path.
          yield* liftResult(this.dataSource.putRecord(this.folderCollection, rkey, value));
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
            yield* emit.recoverableError(new BadRequestError('Refusing to delete empty key'));
          }
          return { removed: 0, skipped: skipped0 };
        }

        // ── Round-trip 1: resolve every key to its (collection, rkey) pair.
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string, resolved: { rkey: string } | null }> = [];
          for (const k of cleanKeys) {
            const r = await this.resolveFile(k);
            if (r) {
              const rkey = `${pathToRkey(stripSlashes(this.stripExtension(k)))}.${r.extension}`;
              out.push({ key: k, resolved: { rkey } });
            } else {
              out.push({ key: k, resolved: null });
            }
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<{ key: string, resolved: { rkey: string } }>;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: ONE applyWrites call with N #delete actions.
        // Atomic across the repo — partial failures roll back.
        if (found.length > 0) {
          const writes: ApplyWritesAction[] = found.map(f => ({
            $type: 'com.atproto.repo.applyWrites#delete',
            collection: this.fileCollection,
            rkey: f.resolved.rkey,
          }));
          const results = yield* liftResult(this.dataSource.applyWrites(writes));
          // applyWrites returns one result per write — surface per-write
          // validation failures as recoverable errors.
          for (let i = 0; i < results.length; i += 1) {
            const r = results[i];
            if (r && r.validationStatus && r.validationStatus !== 'valid') {
              yield* emit.recoverableError(
                new InternalError(
                  `AT Protocol applyWrites validation failed for ${found[i]!.key}: ${r.validationStatus}`,
                ),
              );
            }
          }
        }

        for (const f of found) yield* emit.data(f.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`AT Protocol record not found: ${m.key}`));
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
   * Two rkey-range scans (one file collection, one folder collection)
   * bounded by `[<rkey>:, <rkey>;)`. The repository reconstructs the
   * immediate-children view from each record's `parent` field.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const k = stripSlashes(folderKey);
      const rkeyBase = k === '' ? '' : pathToRkey(k);

      // For root, list everything; for subfolders, range-scan `[<rkey>:, <rkey>;)`.
      const rangeOptions = rkeyBase === ''
        ? { limit: 100 }
        : { rkeyStart: `${rkeyBase}:`, rkeyEnd: `${rkeyBase};`, limit: 100 };

      const [filePage, folderPage] = yield* Effect.all(
        [
          liftResult(this.dataSource.listRecords<StoredAtomValue>(this.fileCollection, rangeOptions)),
          liftResult(this.dataSource.listRecords<StoredAtomValue>(this.folderCollection, rangeOptions)),
        ],
        { concurrency: 2 },
      );

      const seenFiles = new Set<string>();
      const seenFolders = new Set<string>();

      for (const r of filePage.records) {
        if (r.value.parent !== k) continue; // skip deeper descendants
        seenFiles.add(r.value.name);
      }
      for (const r of folderPage.records) {
        if (r.value.parent !== k) continue;
        seenFolders.add(r.value.name);
      }
      // Implicit folders: any deeper file under `<rkey>:` whose direct parent isn't `k`?
      for (const r of filePage.records) {
        if (r.value.parent === k) continue;
        // Path looks like `k/intermediate/...` — the next segment is an implicit folder.
        const parts = r.value.parent === '' ? [] : r.value.parent.split('/');
        const myParts = k === '' ? [] : k.split('/');
        if (parts.length > myParts.length && parts.slice(0, myParts.length).join('/') === k) {
          seenFolders.add(parts[myParts.length]!);
        }
      }

      const callerPrefix = k === '' ? '' : `${k}/`;
      const files: AtomSummary[] = [...seenFiles].map(name => ({
        type: 'object-summary',
        key: callerPrefix + name,
      }));
      const folders: AtomSummary[] = [...seenFolders].map(name => ({
        type: 'folder-summary',
        key: callerPrefix + name,
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
        description:
          'Each object is one AT Protocol record in the file collection; the extension is encoded into the rkey tail and stored in the record value.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over PDS listRecords pages; native cursor pagination not yet pushed down.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}

// Reference rkeyToPath so unused-symbol lints don't trip — this is exported
// for app code that needs to inspect AT Protocol records directly.
void rkeyToPath;
