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

import { EtcdDataSource, type EtcdKv, type TxnOp } from './etcd-datasource.js';

export interface EtcdStorageRepositoryOptions {
  readonly dataSource: EtcdDataSource;
  /**
   * Optional key prefix scoping every operation. Default `''`. Multiple
   * Laika instances can share an etcd cluster by passing distinct prefixes
   * (`/laika/site-a`, `/laika/site-b`).
   */
  readonly basePath?: string;
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

/**
 * The on-wire value stored at each etcd key. JSON-encoded, then base64'd
 * by the data source on its way to the gateway.
 */
interface StoredAtom {
  readonly type: 'file' | 'folder';
  readonly extension?: string;
  readonly content?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A {@link StorageRepository} backed by an etcd v3 cluster, talking the
 * JSON gRPC gateway over `fetch`. Key layout encodes the type so a folder
 * named `notes` and a file named `notes/anything` never collide:
 *
 *     /<basePath>/d/<full-path>            ← folder marker
 *     /<basePath>/f/<full-path>.<ext>      ← file
 *
 * Three traits distinguish this backend:
 *
 *  - **Prefix-scan via `[key, range_end)` pair.** etcd has no `?prefix=`
 *    parameter; instead you compute the smallest key strictly greater
 *    than every key beginning with `prefix` (increment the last byte of
 *    `prefix` — `/` → `0`). The helper {@link prefixRangeEnd} encapsulates
 *    that idiom; this is the first backend in the suite to use it.
 *
 *  - **Atomic multi-key delete via `Txn`.** `removeAtoms(N)` packs N
 *    `requestDeleteRange` ops into one `Txn.success` array. etcd
 *    transactions are linearisable — either all N deletes commit or none
 *    do. The HTTP wire shape is **one** POST regardless of N.
 *
 *  - **Real MVCC revisions surface as `revisionId`.** Every etcd key
 *    carries `mod_revision` — a monotonic cluster-global revision
 *    incremented on each mutation. The repository plumbs this into
 *    `metadata.revisionId`, where prior backends had to settle for ETags
 *    or stringified document ids.
 */
export class EtcdStorageRepository extends StorageRepository {
  private readonly dataSource: EtcdDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly basePath: string;
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: EtcdStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      basePath = '',
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    this.dataSource = dataSource;
    this.basePath = stripSlashes(basePath);
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

  // ───────────────────────── key shaping ─────────────────────────

  private rootPrefix(): string {
    return this.basePath === '' ? '/' : `/${this.basePath}/`;
  }

  private folderKey(key: string): string {
    const k = stripSlashes(key);
    return `${this.rootPrefix()}d/${k}`;
  }

  private filePrefix(key: string): string {
    const k = stripSlashes(this.stripExtension(key));
    return `${this.rootPrefix()}f/${k}`;
  }

  private fileKey(key: string, extension: string): string {
    return `${this.filePrefix(key)}.${extension}`;
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

  /**
   * Resolve an extension-free key to its `(etcd-key, EtcdKv)` pair via a
   * single prefix scan of `/<base>/f/<key>.` — the dot suffix prevents
   * matching `notes/foo` against `notes/foo/bar.md`.
   */
  private async resolveFile(key: string): Promise<{ etcdKey: string; kv: EtcdKv; extension: string } | null> {
    const prefix = `${this.filePrefix(key)}.`;
    const scanned = await this.dataSource.listPrefix(prefix);
    if (Result.isFailure(scanned)) return null;
    for (const kv of scanned.success) {
      // Tail after the prefix must be exactly `<ext>` — no slashes (would
      // mean a deeper subkey, not this key).
      const tail = kv.key.slice(prefix.length);
      if (tail.includes('/')) continue;
      if (this.availableExtensions.includes(tail)) {
        return { etcdKey: kv.key, kv, extension: tail };
      }
    }
    return null;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolveFile(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`etcd key not found: ${key}`));
        }
        const stored = yield* Effect.try({
          try: () => JSON.parse(resolved.kv.value) as StoredAtom,
          catch: () => new InternalError(`etcd value at ${resolved.etcdKey} is not valid JSON`),
        });
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, stored.content ?? ''));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
          content,
          metadata: { extension: resolved.extension, revisionId: resolved.kv.modRevision },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        if (k === '') {
          // Root: succeed if anything exists under either /f/ or /d/.
          const probe = yield* liftResult(this.dataSource.listPrefix(this.rootPrefix(), { limit: 1 }));
          if (probe.length === 0) {
            return yield* Effect.fail(new NotFoundError('etcd folder not found: <root>'));
          }
          const now = new Date().toISOString();
          return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
        }
        const explicit = yield* liftResult(this.dataSource.get(this.folderKey(k)));
        if (explicit) {
          const stored = JSON.parse(explicit.value) as StoredAtom;
          return {
            type: 'folder',
            key: k,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
          } satisfies Folder;
        }
        // Implicit folder — any descendant file under `/f/<k>/`?
        const childProbe = yield* liftResult(
          this.dataSource.listPrefix(`${this.filePrefix(k)}/`, { limit: 1 }),
        );
        if (childProbe.length > 0) {
          const now = new Date().toISOString();
          return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
        }
        return yield* Effect.fail(new NotFoundError(`etcd folder not found: ${k}`));
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
        const now = new Date().toISOString();
        const etcdKey = this.fileKey(create.key, extension);
        const value: StoredAtom = {
          type: TYPE_FILE,
          extension,
          content: serialized,
          createdAt: now,
          updatedAt: now,
        };
        // Use a `Txn` with `compare: createRevision == 0` to make this
        // create-only at the cluster level — even if a concurrent writer
        // raced past `resolveFile`, the Txn won't commit.
        const txn = yield* liftResult(this.dataSource.txn({
          compare: [{ target: 'CREATE', key: etcdKey, result: 'EQUAL', createRevision: '0' }],
          success: [{ requestPut: { key: etcdKey, value: JSON.stringify(value) } }],
        }));
        if (!txn.succeeded) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(`etcd CAS lost: ${create.key} was created concurrently`),
          );
        }
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveFile(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`etcd key not found: ${update.key}`));
        }
        if (update.content) {
          const stored = JSON.parse(existing.kv.value) as StoredAtom;
          const serialized = yield* Effect.promise(() =>
            this.serialize(existing.extension, update.content!)
          );
          const newValue: StoredAtom = {
            ...stored,
            content: serialized,
            updatedAt: new Date().toISOString(),
          };
          yield* liftResult(this.dataSource.put(existing.etcdKey, JSON.stringify(newValue)));
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
        const now = new Date().toISOString();
        const etcdKey = existing?.etcdKey ?? this.fileKey(create.key, extension);
        const existingStored = existing
          ? (JSON.parse(existing.kv.value) as StoredAtom)
          : null;
        const newValue: StoredAtom = {
          type: TYPE_FILE,
          extension,
          content: serialized,
          createdAt: existingStored?.createdAt ?? now,
          updatedAt: now,
        };
        yield* liftResult(this.dataSource.put(etcdKey, JSON.stringify(newValue)));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(folderCreate.key);
        if (k === '') return yield* LaikaTask.runValue(this.getFolder(''));
        const etcdKey = this.folderKey(k);
        const existing = yield* liftResult(this.dataSource.get(etcdKey));
        const now = new Date().toISOString();
        if (!existing) {
          const value: StoredAtom = { type: TYPE_FOLDER, createdAt: now, updatedAt: now };
          yield* liftResult(this.dataSource.put(etcdKey, JSON.stringify(value)));
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

        // ── Round-trip 1: resolve every key to its (etcd-key, kv) pair.
        // Done in parallel for wall-clock latency.
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string; resolved: { etcdKey: string } | null }> = [];
          for (const k of cleanKeys) {
            const r = await this.resolveFile(k);
            out.push({ key: k, resolved: r ? { etcdKey: r.etcdKey } : null });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<
          { key: string; resolved: { etcdKey: string } }
        >;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: ONE etcd Txn with N `requestDeleteRange` ops.
        // etcd transactions are linearisable — atomic at the cluster level.
        if (found.length > 0) {
          const ops: TxnOp[] = found.map(f => ({
            requestDeleteRange: { key: f.resolved.etcdKey },
          }));
          yield* liftResult(this.dataSource.txn({ success: ops }));
        }

        for (const f of found) yield* emit.data(f.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`etcd key not found: ${m.key}`));
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
   * Two prefix scans — one over `/d/<folder>/` for explicit folder
   * children, one over `/f/<folder>/` for files. etcd has no client-side
   * delimiter parameter, so we reconstruct subfolder hierarchy from the
   * key tail.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const k = stripSlashes(folderKey);
      const dPrefix = k === '' ? `${this.rootPrefix()}d/` : `${this.folderKey(k)}/`;
      const fPrefix = k === '' ? `${this.rootPrefix()}f/` : `${this.filePrefix(k)}/`;

      const [folders, files] = yield* Effect.all(
        [
          liftResult(this.dataSource.listPrefix(dPrefix)),
          liftResult(this.dataSource.listPrefix(fPrefix)),
        ],
        { concurrency: 2 },
      );

      const seenFiles = new Set<string>();
      const seenFolders = new Set<string>();

      for (const kv of files) {
        const tail = kv.key.slice(fPrefix.length);
        if (tail === '') continue;
        const slash = tail.indexOf('/');
        if (slash === -1) {
          let leaf = tail;
          for (const ext of this.availableExtensions) {
            if (leaf.endsWith(`.${ext}`)) { leaf = leaf.slice(0, -(ext.length + 1)); break; }
          }
          seenFiles.add(leaf);
        } else {
          // Deeper file — implies an implicit subfolder at this level.
          seenFolders.add(tail.slice(0, slash));
        }
      }
      for (const kv of folders) {
        const tail = kv.key.slice(dPrefix.length);
        if (tail === '') continue;
        const slash = tail.indexOf('/');
        if (slash === -1) seenFolders.add(tail);
        else seenFolders.add(tail.slice(0, slash));
      }

      const callerPrefix = k === '' ? '' : `${k}/`;
      const fileSummaries: AtomSummary[] = [...seenFiles].map(name => ({
        type: 'object-summary',
        key: callerPrefix + name,
      }));
      const folderSummaries: AtomSummary[] = [...seenFolders].map(name => ({
        type: 'folder-summary',
        key: callerPrefix + name,
      }));

      const merged = [...fileSummaries, ...folderSummaries]
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
        description: 'Each object is one etcd key under /f/, with the extension encoded in the key tail.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over etcd range responses; native `limit` is the only pushdown.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
