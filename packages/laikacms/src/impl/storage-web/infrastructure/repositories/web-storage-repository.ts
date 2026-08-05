import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  IllegalStateException,
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
  Capabilities,
  CompatibilityDate,
  defaultDetermineExtension,
  type DetermineExtension,
  naturalCompare,
  pathCombine,
  StorageRepository,
  unsupportedChanges,
} from 'laikacms/storage';
import * as minimatch from 'minimatch';

import { type WebStorageProvider } from '../datasources/web-storage-datasource.js';
import { WebStorageDataSource } from '../datasources/web-storage-datasource.js';

/**
 * Constructor options for {@link WebStorageRepository}.
 *
 * ### Security & data integrity
 *
 * The Web `Storage` API (`localStorage`/`sessionStorage`) is **world-readable to any
 * script running on the same origin** — it is not a secret store, has no access
 * control of its own, and every write it accepts is inherently unauthenticated
 * (there is no server in the loop to check who's writing). Never store credentials,
 * API keys, or other secrets in a `WebStorageRepository`. Authorization for
 * client-writable content belongs on a server proxy path (e.g.
 * `laikacms/storage/jsonapi-proxy`), not in this repository.
 */
export interface WebStorageRepositoryOptions {
  /**
   * Any object implementing the Web `Storage` interface (`getItem`, `setItem`,
   * `removeItem`, `key`, `length`, `clear`) — `localStorage`, `sessionStorage`, or
   * an in-memory shim for testing/SSR.
   *
   * When omitted, `globalThis.localStorage` is resolved **lazily**, on the first
   * operation that needs it — never at construction or import time — so this
   * repository can be constructed (though not yet *used*) during SSR.
   */
  storage?: Storage;
  serializerRegistry: StorageSerializerRegistry;
  /** Extension used for newly created objects when no other extension is determined. */
  defaultExtension: string;
  /**
   * Prefix every physical Web Storage key is namespaced under
   * (`${namespace}:${key}`), so a `WebStorageRepository` never reads, lists,
   * overwrites, or deletes a key belonging to a different namespace or to
   * unrelated data already present in the same `Storage`.
   *
   * @default 'laikacms'
   */
  namespace?: string;
  /** Same default-exclusions convention as the other storage repositories. */
  ignoreList?: string[];
  determineExtension?: DetermineExtension;
}

const DEFAULT_NAMESPACE = 'laikacms';

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.contentbase',
  '**/.laikacms',
];

const liftResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

const NO_STORAGE_MESSAGE = 'WebStorageRepository: no `storage` option was provided and '
  + '`globalThis.localStorage` is unavailable (this is expected during SSR — the module import '
  + 'itself never touches it). Pass an explicit Web Storage-compatible object such as '
  + '`localStorage`, `sessionStorage`, or an in-memory shim, or only exercise this repository '
  + 'once running on the client.';

/**
 * `WebStorageRepository` implements the `StorageRepository` contract against an
 * **injectable** Web `Storage` object (`localStorage`, `sessionStorage`, or a
 * shim), so LaikaCMS content can be read **and written** directly in the browser
 * with no server involved.
 *
 * Web Storage is a flat key-value store, so this repository simulates a
 * hierarchical file system the same way `R2StorageRepository` does for
 * Cloudflare R2:
 * - Folders are represented by key prefixes (derived, not physically stored).
 * - Empty folders are represented by `.keep` marker entries.
 * - Every physical key is namespaced (`${namespace}:${key}`) so distinct
 *   repositories can share one `Storage` without colliding.
 *
 * The default backing store (`globalThis.localStorage`) is resolved lazily, on
 * first use — never at import or construction time — so this module and an
 * unused repository instance are safe to include in isomorphic/SSR bundles.
 *
 * See {@link WebStorageRepositoryOptions} for the security note on Web Storage
 * not being a secret store.
 */
export class WebStorageRepository extends StorageRepository {
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly dataSource: WebStorageDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly determineExtension: DetermineExtension;
  private resolvedDefaultStorage: Storage | undefined;

  constructor(options: WebStorageRepositoryOptions) {
    super();
    const {
      storage,
      serializerRegistry,
      defaultExtension,
      namespace = DEFAULT_NAMESPACE,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultExtension.startsWith('.') ? defaultExtension.slice(1) : defaultExtension;
    this.determineExtension = determineExtension;

    const provider: WebStorageProvider = storage
      ? () => storage
      : () => this.resolveDefaultStorage();

    const availableExtensions = Object.keys(this.serializerRegistry);
    this.dataSource = new WebStorageDataSource(provider, namespace, availableExtensions);
    this.excludeFilter = ignoreList
      .map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true }))
      .filter((x): x is minimatch.MMRegExp => x !== false);
  }

  /**
   * Resolves `globalThis.localStorage` on first use only. Throws a typed
   * {@link IllegalStateException} — never a raw `ReferenceError`/`undefined`
   * access — when no global `localStorage` exists (SSR with no `storage`
   * option supplied). Callers always reach this through a datasource method
   * that wraps its body in try/catch, so the throw becomes a typed
   * `LaikaResult` failure rather than a defect crossing the `LaikaTask` boundary.
   */
  private resolveDefaultStorage(): Storage {
    if (this.resolvedDefaultStorage) return this.resolvedDefaultStorage;
    const globalStorage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!globalStorage) throw new IllegalStateException(NO_STORAGE_MESSAGE);
    this.resolvedDefaultStorage = globalStorage;
    return globalStorage;
  }

  private async serialize(ext: string, content: StorageObjectContent): Promise<string> {
    if (ext.startsWith('.')) ext = ext.slice(1);
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
      );
    }
    try {
      return await serializer.serializeDocumentFileContents(content, {});
    } catch (error) {
      throw new BadRequestError(
        `Failed to serialize content: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async deserialize(ext: string, content: string): Promise<StorageObjectContent> {
    if (ext.startsWith('.')) ext = ext.slice(1);
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
      );
    }
    try {
      return await serializer.deserializeDocumentFileContents(content, {});
    } catch (error) {
      throw new BadRequestError(
        `Failed to deserialize content: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(this.dataSource.getFolderMeta(key));
        return {
          type: 'folder',
          key,
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
        } satisfies Folder;
      })
    );
  }

  /**
   * Probes `getObject` first; only a `NotFoundError` triggers the folder
   * fallback. Any other failure (e.g. `IllegalStateException` from a missing
   * default `Storage` during SSR) propagates as-is rather than being masked by
   * a swallowed boolean check.
   */
  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const objectResult = yield* Effect.result(LaikaTask.runValue(this.getObject(key)));
        if (Result.isSuccess(objectResult)) return objectResult.success;
        if (!(objectResult.failure instanceof NotFoundError)) {
          return yield* Effect.fail(objectResult.failure);
        }
        return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
      })
    );
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const [meta, contents] = yield* Effect.all(
          [
            liftResult(this.dataSource.getObjectMeta(key)),
            liftResult(this.dataSource.getObjectContents(key)),
          ],
          { concurrency: 2 },
        );
        const ext = contents.extension;
        const content = yield* Effect.promise(() => this.deserialize(ext, contents.content));
        return {
          type: 'object',
          key: contents.key,
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
          content,
          metadata: { extension: ext },
        } satisfies StorageObject;
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(this.dataSource.getObjectMeta(update.key));
        const ext = meta.extension;
        if (update.content) {
          const stringified = yield* Effect.promise(() => this.serialize(ext, update.content!));
          yield* liftResult(this.dataSource.createOrUpdate(update.key, stringified, ext));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required for creation'));
        }
        const existingExt = yield* Effect.promise(() => this.dataSource.findExistingObjectExtension(create.key));
        if (existingExt) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existingExt}`,
            ),
          );
        }
        const ext = this.resolveExtension(create.key, create.metadata);
        const stringified = yield* Effect.promise(() => this.serialize(ext, create.content!));
        yield* liftResult(this.dataSource.createOrUpdate(create.key, stringified, ext));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existingExt = yield* Effect.promise(() => this.dataSource.findExistingObjectExtension(create.key));
        const ext = existingExt ?? this.resolveExtension(create.key, create.metadata);
        const stringified = create.content
          ? yield* Effect.promise(() => this.serialize(ext, create.content!))
          : '';
        yield* liftResult(this.dataSource.createOrUpdate(create.key, stringified, ext));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(
          this.dataSource.createOrUpdate(pathCombine(folderCreate.key, '.keep'), '', ''),
        );
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const results = yield* Effect.promise(async () => {
          const out: LaikaResult<string>[] = [];
          for await (const r of this.dataSource.deleteObjects(keys)) out.push(r);
          return out;
        });

        let removed = 0;
        let skipped = 0;
        for (const r of results) {
          if (Result.isFailure(r)) {
            yield* emit.recoverableError(r.failure);
            skipped += 1;
            continue;
          }
          yield* emit.data(r.success);
          removed += 1;
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
        const { summaries, total, missingFolder } = yield* this.collectFilteredSummaries(folderKey, options);
        if (missingFolder) yield* emit.recoverableError(missingFolder);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total };
      })
    );
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const { summaries, total, missingFolder } = yield* this.collectFilteredSummaries(folderKey, options);
        if (missingFolder) yield* emit.recoverableError(missingFolder);
        for (const summary of summaries) {
          if (summary.type === 'object-summary') {
            const r = yield* Effect.result(LaikaTask.runValueForwarding(this.getObject(summary.key), emit));
            if (Result.isFailure(r)) yield* emit.recoverableError(r.failure);
            else yield* emit.data(r.success);
          } else {
            const r = yield* Effect.result(LaikaTask.runValueForwarding(this.getFolder(summary.key), emit));
            if (Result.isFailure(r)) yield* emit.recoverableError(r.failure);
            else yield* emit.data(r.success);
          }
        }
        return { total };
      })
    );
  }

  /**
   * Recursively collect Web Storage entries under `folderKey` up to
   * `maxRelativeDepth` levels below the starting folder. Mirrors the
   * `R2StorageRepository`/`FileSystemStorageRepository` contract: a `NotFoundError`
   * from the root-level listing surfaces as `missingFolder` rather than silently
   * returning an empty array.
   */
  private async collectEntriesRecursively(
    folderKey: string,
    maxRelativeDepth: number,
    currentRelativeDepth: number = 1,
  ): Promise<{ entries: Array<{ key: string, type: string }>, missingFolder?: LaikaError }> {
    const result = await this.dataSource.listDirectory(folderKey);
    if (Result.isFailure(result)) {
      if (currentRelativeDepth === 1) return { entries: [], missingFolder: result.failure };
      return { entries: [] };
    }
    const entries: Array<{ key: string, type: string }> = [];
    for (const entry of result.success) {
      entries.push(entry);
      if (entry.type === 'dir' && currentRelativeDepth < maxRelativeDepth) {
        const child = await this.collectEntriesRecursively(entry.key, maxRelativeDepth, currentRelativeDepth + 1);
        entries.push(...child.entries);
      }
    }
    return { entries };
  }

  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<{ summaries: ReadonlyArray<AtomSummary>, total: number, missingFolder?: LaikaError }, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const { entries, missingFolder } = yield* Effect.promise(() =>
        this.collectEntriesRecursively(folderKey, options.depth)
      );
      if (missingFolder) {
        return { summaries: [] as ReadonlyArray<AtomSummary>, total: 0, missingFolder };
      }
      const availableExtensions = Object.keys(this.serializerRegistry);
      const filtered = entries
        .filter((entry: { key: string, type: string }) => this.excludeFilter.every(pattern => !pattern.test(entry.key)))
        .map((entry: { key: string, type: string }): AtomSummary => {
          let key = entry.key;
          if (entry.type === 'file') {
            for (const ext of availableExtensions) {
              if (key.endsWith(`.${ext}`)) {
                key = key.slice(0, -(ext.length + 1));
                break;
              }
            }
          }
          return {
            type: entry.type === 'file' ? 'object-summary' : 'folder-summary',
            key,
          };
        });
      const sorted = [...filtered].sort((a, b) => naturalCompare(a.key, b.key));
      const total = sorted.length;
      return { summaries: applyPagination(sorted, options.pagination), total };
    });
  }

  private resolveExtension(key: string, metadata: StorageObject['metadata'] | undefined): string {
    const requested = this.determineExtension(key, { metadata, defaultExtension: this.defaultFileExtension });
    if (requested && this.serializerRegistry[requested]) return requested;
    return this.defaultFileExtension;
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-08-04'),
      fileExtensions: {
        supported: true,
        description: 'Supported file types depend on the serializers provided to this repository.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over key-prefix listings; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
      changes: unsupportedChanges,
    });
  }
}
