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
  StorageRepository,
  unsupportedChanges,
} from 'laikacms/storage';
import * as minimatch from 'minimatch';

import type {
  WebFsAccessMode,
  WebFsDirectoryHandle,
  WebFsRootInput,
  WebFsRootProvider,
} from '../../domain/types/web-fs-handles.js';
import { WebFsDataSource } from '../datasources/web-fs-datasource.js';

/**
 * Constructor options for {@link WebFsStorageRepository}.
 *
 * ### Security & data integrity
 *
 * Everything a directory handle reaches is **readable and writable by any
 * script that obtains the same handle** — an origin-private root by every
 * script on the origin, a user-picked directory by every other program on the
 * machine. There is no access control of its own, and every write it accepts
 * is inherently unauthenticated (there is no server in the loop to check
 * who's writing). Never store credentials, API keys, or other secrets in a
 * `WebFsStorageRepository`. Authorization for client-writable content belongs
 * on a server proxy path (e.g. `laikacms/storage/jsonapi-proxy`), not in this
 * repository.
 */
export interface WebFsStorageRepositoryOptions {
  /**
   * The root directory to store content under: a `FileSystemDirectoryHandle`
   * from anywhere — `await navigator.storage.getDirectory()` (or any
   * subdirectory of it), a user-picked `await showDirectoryPicker()`
   * directory, an in-memory shim satisfying the same structural contract — or
   * a provider resolving one lazily. The repository deliberately does not
   * care where the handle came from; it (re-)validates permission and
   * liveness on every operation instead.
   *
   * When omitted, `navigator.storage.getDirectory()` is resolved **lazily**,
   * on the first operation that needs it — never at construction or import
   * time — so this repository can be constructed (though not yet *used*)
   * during SSR.
   */
  root?: WebFsRootInput;
  /**
   * Access mode passed to `queryPermission()` when the root handle exposes it
   * (user-picked `showDirectoryPicker()` handles do; origin-private
   * handles typically don't and are treated as granted). This only controls
   * what is *queried* — a `'read'`-granted root still fails writes at write
   * time with a `PermissionDeniedError`.
   *
   * @default 'readwrite'
   */
  mode?: WebFsAccessMode;
  serializerRegistry: StorageSerializerRegistry;
  /** Extension used for newly created objects when no other extension is determined. */
  defaultExtension: string;
  /**
   * Subdirectory chain below `root` that every operation is scoped under, so
   * a `WebFsStorageRepository` never reads, lists, overwrites, or deletes an
   * entry belonging to a different namespace or to unrelated data already
   * present in the same directory tree. Pass `''` to use `root` as-is.
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
  '**/.catalog',
  '**/.laikacms',
];

const liftResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

const NO_DEFAULT_ROOT_MESSAGE = 'WebFsStorageRepository: no `root` option was provided and '
  + '`navigator.storage.getDirectory` is unavailable (this is expected during SSR and in insecure '
  + 'browsing contexts — the module import itself never touches it). Pass an explicit '
  + '`FileSystemDirectoryHandle`, an in-memory shim, or a provider, or only exercise this '
  + 'repository once running on the client in a secure context.';

/**
 * `WebFsStorageRepository` implements the `StorageRepository` contract against
 * the browser's **File System API** — any `FileSystemDirectoryHandle`, whether
 * it points into the origin-private file system (the default), a user-picked
 * `showDirectoryPicker()` directory (Chromium then reads and writes real
 * on-disk files), or an injected shim — so LaikaCMS content can be read **and
 * written** directly in the browser with no server involved.
 *
 * The File System API exposes a real hierarchical file system, so unlike the
 * flat-store implementations (`storage-r2`, `storage-web`) nothing is
 * simulated:
 * - Folders are real directories; empty folders exist without `.keep` markers.
 * - Object contents are stored as raw files (readable by any other consumer
 *   of the same directory tree), not JSON envelopes.
 * - Every operation is scoped under a real `namespace` subdirectory so
 *   distinct repositories can share one root without colliding.
 *
 * The default backing root (`navigator.storage.getDirectory()`) is resolved
 * lazily, on first use — never at import or construction time — so this
 * module and an unused repository instance are safe to include in
 * isomorphic/SSR bundles.
 *
 * ### Permissions & handle validity
 *
 * The repository does not care where a handle came from — freshly picked,
 * restored from wherever the application persists handles (also in a service
 * worker, where permission prompts are unavailable), or origin-private.
 * Whatever was true when the handle was obtained may not be true now:
 * policies change, browsers change, permissions change. So before every
 * operation the repository re-checks `queryPermission({ mode })` when the
 * handle exposes it (handles without it are treated as granted) and verifies
 * the handle still connects to an existing directory. It **never calls
 * `requestPermission()`** — that needs a user gesture — and instead fails
 * with a typed error that tells the application how to recover:
 *
 * - `PermissionPromptRequiredError` — call
 *   `handle.requestPermission({ mode })` in a user gesture, then retry the
 *   operation.
 * - `PermissionDeniedError` — access was refused (or revoked mid-session);
 *   the user must grant it anew.
 * - `StaleHandleError` — the directory was deleted/moved or the persisted
 *   handle expired; have the user pick the directory again and replace the
 *   stored handle.
 *
 * A `root` provider throwing (e.g. the application has no handle stored yet)
 * surfaces as a typed `IllegalStateException`, so every failure mode of "give
 * me a usable directory" is distinguishable by the caller.
 *
 * See {@link WebFsStorageRepositoryOptions} for the security note on the
 * backing directory not being a secret store.
 */
export class WebFsStorageRepository extends StorageRepository {
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly dataSource: WebFsDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly determineExtension: DetermineExtension;

  constructor(options: WebFsStorageRepositoryOptions) {
    super();
    const {
      root,
      mode = 'readwrite',
      serializerRegistry,
      defaultExtension,
      namespace = DEFAULT_NAMESPACE,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultExtension.startsWith('.') ? defaultExtension.slice(1) : defaultExtension;
    this.determineExtension = determineExtension;

    // A real `FileSystemDirectoryHandle` and an `WebFsDirectoryHandle` are
    // runtime-identical for the operations this repository performs; the casts
    // only bridge `lib` configurations whose DOM types omit async iteration.
    const provider: WebFsRootProvider = typeof root === 'function'
      ? async () => (await root()) as WebFsDirectoryHandle
      : root
      ? async () => root as WebFsDirectoryHandle
      : () => this.resolveDefaultRoot();

    const availableExtensions = Object.keys(this.serializerRegistry);
    this.dataSource = new WebFsDataSource(provider, namespace, availableExtensions, mode);
    this.excludeFilter = ignoreList
      .map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true }))
      .filter((x): x is minimatch.MMRegExp => x !== false);
  }

  /**
   * Resolves `navigator.storage.getDirectory()` on first use only. Throws a
   * typed {@link IllegalStateException} — never a raw `ReferenceError`/
   * `undefined` access — when the origin-private default root is unavailable
   * (SSR, or an insecure
   * browsing context, with no `root` option supplied). Callers always reach
   * this through a datasource method that wraps its body in try/catch, so the
   * throw becomes a typed `LaikaResult` failure rather than a defect crossing
   * the `LaikaTask` boundary.
   */
  private resolveDefaultRoot(): Promise<WebFsDirectoryHandle> {
    const storageManager = (globalThis as {
      navigator?: { storage?: { getDirectory?: () => Promise<WebFsDirectoryHandle> } },
    }).navigator?.storage;
    if (typeof storageManager?.getDirectory !== 'function') {
      throw new IllegalStateException(NO_DEFAULT_ROOT_MESSAGE);
    }
    return storageManager.getDirectory();
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
   * default root during SSR) propagates as-is rather than being masked by a
   * swallowed boolean check.
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
        yield* liftResult(this.dataSource.createFolder(folderCreate.key));
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const results = yield* Effect.promise(async () => {
          const out: LaikaResult<string>[] = [];
          for await (const r of this.dataSource.deleteAtoms(keys)) out.push(r);
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
   * Recursively collect directory entries under `folderKey` up to
   * `maxRelativeDepth` levels below the starting folder. Mirrors the
   * `R2StorageRepository`/`FileSystemStorageRepository` contract: a
   * `NotFoundError` from the root-level listing surfaces as `missingFolder`
   * rather than silently returning an empty array. An existing empty folder
   * lists as zero entries with no error — the directories are real, so no
   * `.keep` marker is needed to make that distinction.
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
      compatibilityDate: CompatibilityDate.make('2026-08-07'),
      fileExtensions: {
        supported: true,
        description: 'Supported file types depend on the serializers provided to this repository.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over directory listings; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
      changes: unsupportedChanges,
    });
  }
}
