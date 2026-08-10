import * as fs from 'fs/promises';
import { type FSWatcher, watch } from 'node:fs';
import * as path from 'path';

import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  InvalidData,
  LaikaError,
  type LaikaResult,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
import type {
  Atom,
  AtomSummary,
  ChangeListener,
  ChangeSummary,
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
  SubscribeChangesOptions,
  Unsubscribe,
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
} from 'laikacms/storage';
import * as minimatch from 'minimatch';

import { FileSystemDataSource } from '../datasources/filesystem-datasource.js';

/**
 * Lift `Promise<LaikaResult<A>>` into `Effect<A, LaikaError>` — the typical
 * datasource call shape in this implementation.
 */
const liftResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

/**
 * Lift a Promise that may reject with a `LaikaError` (or a plain `Error`)
 * into a typed `Effect<A, LaikaError>`. Unlike `Effect.promise`, rejections
 * become typed failures rather than defects — this is essential for keeping
 * the LaikaTask channel alive when a serializer throws, because defects
 * bypass `Effect.matchEffect` and leave the task's queue unsignalled (hang).
 */
const liftSerialize = <A>(p: Promise<A>): Effect.Effect<A, LaikaError> =>
  Effect.tryPromise({
    try: () => p,
    catch: err => {
      if (err instanceof LaikaError) return err;
      if (err instanceof Error) {
        return new BadRequestError(err.message, {
          cause: err,
          translation: { message: 'storage.fs.invalidRequest' },
        });
      }
      return new BadRequestError(String(err), { translation: { message: 'storage.fs.invalidRequest' } });
    },
  });

/** Quiet window before a coalesced change batch is delivered to listeners. */
const CHANGE_DEBOUNCE_MS = 50;

export class FileSystemStorageRepository extends StorageRepository {
  private excludeFilter: minimatch.MMRegExp[];
  private fileSystemDataSource: FileSystemDataSource;

  /** The single shared `fs.watch` handle, started lazily on first subscriber. */
  private watcher: FSWatcher | undefined;
  /** Active subscribers, each with the scope it asked for. */
  private readonly changeSubscriptions = new Map<ChangeListener, SubscribeChangesOptions>();
  /** Coalesced changes awaiting the next flush: key → its on-disk relative path. */
  private pendingChanges = new Map<string, string>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly rootDirectory: string,
    private readonly serializerRegistry: StorageSerializerRegistry,
    private readonly defaultFileExtension: string,
    private readonly ignoreList: string[] = [
      '**/.keep',
      '**/.gitkeep',
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/desktop.ini',
      '**/.catalog',
      '**/.laikacms',
    ],
    /**
     * Optional callback that picks the file extension for a new object.
     */
    private readonly determineExtension: DetermineExtension = defaultDetermineExtension,
  ) {
    super();
    if (defaultFileExtension.startsWith('.')) {
      this.defaultFileExtension = defaultFileExtension.slice(1);
    }
    const availableExtensions = Object.keys(this.serializerRegistry);
    this.fileSystemDataSource = new FileSystemDataSource(availableExtensions, defaultFileExtension);
    this.excludeFilter = this.ignoreList
      .map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true }))
      .filter(x => x !== false);
  }

  /** Serialize StorageObjectContent to a string for storage on disk. */
  private async serialize(ext: string, content: StorageObjectContent): Promise<string> {
    if (ext.startsWith('.')) ext = ext.slice(1);
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
        { translation: { message: 'storage.fs.invalidRequest' } },
      );
    }
    try {
      return await serializer.serializeDocumentFileContents(content, {});
    } catch (error) {
      throw new BadRequestError(
        `Failed to serialize content: ${error instanceof Error ? error.message : String(error)}`,
        { translation: { message: 'storage.fs.invalidRequest' } },
      );
    }
  }

  /** Deserialize raw file contents back into StorageObjectContent. */
  private async deserialize(ext: string, content: string): Promise<StorageObjectContent> {
    if (ext.startsWith('.')) ext = ext.slice(1);
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
        { translation: { message: 'storage.fs.invalidRequest' } },
      );
    }
    try {
      return await serializer.deserializeDocumentFileContents(content, {});
    } catch (error) {
      throw new BadRequestError(
        `Failed to deserialize content: ${error instanceof Error ? error.message : String(error)}`,
        { translation: { message: 'storage.fs.invalidRequest' } },
      );
    }
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(
          this.fileSystemDataSource.getDirMeta(this.rootDirectory, key),
        );
        return {
          type: 'folder',
          key,
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const isDir = yield* Effect.promise(() =>
          this.fileSystemDataSource.isDir(this.rootDirectory, key).catch(() => false)
        );
        if (isDir) {
          return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
        }
        return yield* LaikaTask.runValue(this.getObject(key)) as Effect.Effect<Atom, LaikaError>;
      })
    );
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const [meta, contents] = yield* Effect.all(
          [
            liftResult(this.fileSystemDataSource.getFileMeta(this.rootDirectory, key)),
            liftResult(this.fileSystemDataSource.getFileContents(this.rootDirectory, key)),
          ],
          { concurrency: 2 },
        );

        const ext = contents.extension;
        const content = yield* liftSerialize(this.deserialize(ext, contents.content));

        return {
          type: 'object',
          key: contents.path,
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
        const meta = yield* liftResult(
          this.fileSystemDataSource.getFileMeta(this.rootDirectory, update.key),
        );
        const ext = meta.extension;

        if (update.content) {
          const stringified = yield* liftSerialize(this.serialize(ext, update.content!));
          yield* liftResult(
            this.fileSystemDataSource.createOrUpdate(this.rootDirectory, update.key, stringified, ext),
          );
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(
            new InvalidData('Object content is required for creation', {
              translation: { message: 'storage.fs.contentRequired' },
            }),
          );
        }
        const existingExt = yield* Effect.promise(() =>
          this.fileSystemDataSource.findExistingFileExtension(this.rootDirectory, create.key)
        );
        if (existingExt) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existingExt}`,
              { translation: { message: 'storage.fs.entryAlreadyExists' } },
            ),
          );
        }
        const ext = this.resolveExtension(create.key, create.metadata);
        const stringified = yield* liftSerialize(this.serialize(ext, create.content!));
        yield* liftResult(
          this.fileSystemDataSource.createOrUpdate(this.rootDirectory, create.key, stringified, ext),
        );
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existingExt = yield* Effect.promise(() =>
          this.fileSystemDataSource.findExistingFileExtension(this.rootDirectory, create.key)
        );
        const ext = existingExt ?? this.resolveExtension(create.key, create.metadata);
        const stringified = create.content
          ? yield* liftSerialize(this.serialize(ext, create.content!))
          : '';
        yield* liftResult(
          this.fileSystemDataSource.createOrUpdate(this.rootDirectory, create.key, stringified, ext),
        );
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(
          this.fileSystemDataSource.createOrUpdate(
            this.rootDirectory,
            pathCombine(folderCreate.key, '.keep'),
            '',
            '',
          ),
        );
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const batches = yield* Effect.promise(async () => {
          // Resolve each key to its actual on-disk path (with extension)
          const availableExtensions = Object.keys(this.serializerRegistry);
          const resolvedEntries: Array<{ path: string, type: 'file' | 'dir' }> = [];
          for (const key of keys) {
            try {
              const stat = await fs.stat(path.join(this.rootDirectory, key));
              if (stat.isDirectory()) {
                resolvedEntries.push({ path: key, type: 'dir' });
                continue;
              }
              resolvedEntries.push({ path: key, type: 'file' });
            } catch {
              // Not a raw path — try with each known extension. Only strip a
              // trailing dot-segment that matches a registered serializer
              // extension; a dot that is part of the key itself (e.g.
              // releases/v1.2-notes) must not be consumed (LCMS-278).
              let keyWithoutExt = key;
              for (const ext of availableExtensions) {
                if (key.endsWith(`.${ext}`)) {
                  keyWithoutExt = key.slice(0, -(ext.length + 1));
                  break;
                }
              }
              let found = false;
              for (const ext of availableExtensions) {
                const candidate = `${keyWithoutExt}.${ext}`;
                try {
                  await fs.access(path.join(this.rootDirectory, candidate));
                  resolvedEntries.push({ path: candidate, type: 'file' });
                  found = true;
                  break;
                } catch { /* try next */ }
              }
              if (!found) {
                // Not found — pass as-is so deleteEntries reports it as skipped
                resolvedEntries.push({ path: key, type: 'file' });
              }
            }
          }

          const out: LaikaResult<{ path: string }[]>[] = [];
          for await (
            const batch of this.fileSystemDataSource.deleteEntries(
              this.rootDirectory,
              resolvedEntries,
            )
          ) out.push(batch);
          return out;
        });

        let removed = 0;
        let skipped = 0;
        for (const batch of batches) {
          if (Result.isFailure(batch)) {
            yield* emit.recoverableError(batch.failure);
            skipped += 1;
            continue;
          }
          for (const dirSub of batch.success) {
            yield* emit.data(dirSub.path);
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
        const { summaries, total } = yield* this.collectFilteredSummaries(folderKey, options);
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
   * Recursively collect all file-system entries under `folderKey` up to
   * `maxRelativeDepth` levels below the starting folder (depth=1 means direct
   * children only, depth=2 means children and grandchildren, etc.).
   *
   * Returns a flat list of `{ path, type }` DirSub entries. The first call
   * that encounters a `NotFoundError` for the root folder bubbles it up as the
   * returned `missingFolder` rather than failing the whole stream.
   */
  private async collectEntriesRecursively(
    folderKey: string,
    maxRelativeDepth: number,
    currentRelativeDepth: number = 1,
  ): Promise<{ entries: Array<{ path: string, type: string }>, missingFolder?: LaikaError }> {
    const dirResult = await this.fileSystemDataSource.listFileSystemDirectory(this.rootDirectory, folderKey);
    if (Result.isFailure(dirResult)) {
      if (currentRelativeDepth === 1 && dirResult.failure instanceof NotFoundError) {
        return { entries: [], missingFolder: dirResult.failure };
      }
      return { entries: [] };
    }
    const entries: Array<{ path: string, type: string }> = [];
    for (const entry of dirResult.success) {
      entries.push(entry);
      if (entry.type === 'dir' && currentRelativeDepth < maxRelativeDepth) {
        const child = await this.collectEntriesRecursively(
          entry.path,
          maxRelativeDepth,
          currentRelativeDepth + 1,
        );
        entries.push(...child.entries);
      }
    }
    return { entries };
  }

  /**
   * Shared filtering + pagination for listAtoms / listAtomSummaries.
   *
   * A missing folder is not a fatal error for a listing: it surfaces as
   * `missingFolder` (a recoverable {@link NotFoundError}) with an empty
   * `summaries` array, so callers can emit a warning rather than crashing the
   * stream.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<{ summaries: ReadonlyArray<AtomSummary>, total: number, missingFolder?: LaikaError }, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const { entries: dirSubs, missingFolder } = yield* Effect.promise(() =>
        this.collectEntriesRecursively(folderKey, options.depth)
      );
      if (missingFolder) {
        return { summaries: [] as ReadonlyArray<AtomSummary>, total: 0, missingFolder };
      }
      const availableExtensions = Object.keys(this.serializerRegistry);
      const filtered = dirSubs
        .filter((dirSub: { path: string, type: string }) =>
          this.excludeFilter.every(pattern => !pattern.test(dirSub.path))
        )
        .map((dirSub: { path: string, type: string }): AtomSummary => {
          let key = dirSub.path;
          if (dirSub.type === 'file') {
            for (const ext of availableExtensions) {
              if (key.endsWith(`.${ext}`)) {
                key = key.slice(0, -(ext.length + 1));
                break;
              }
            }
          }
          return {
            type: dirSub.type === 'file' ? 'object-summary' : 'folder-summary',
            key,
          };
        });
      const sorted = [...filtered].sort((a, b) => naturalCompare(a.key, b.key));
      const total = sorted.length;
      const page = applyPagination(sorted, options.pagination);
      // Stat each page entry to populate createdAt/updatedAt; stat failures are
      // silently ignored so a single unreadable entry doesn't break the listing.
      const summaries = yield* Effect.promise(() =>
        Promise.all(
          page.map(async (summary): Promise<AtomSummary> => {
            const metaResult = summary.type === 'object-summary'
              ? await this.fileSystemDataSource.getFileMeta(this.rootDirectory, summary.key)
              : await this.fileSystemDataSource.getDirMeta(this.rootDirectory, summary.key);
            if (Result.isFailure(metaResult)) return summary;
            return {
              ...summary,
              createdAt: metaResult.success.createdAt.toISOString(),
              updatedAt: metaResult.success.updatedAt.toISOString(),
            };
          }),
        )
      );
      return { summaries, total };
    });
  }

  private resolveExtension(
    key: string,
    metadata: StorageObject['metadata'] | undefined,
  ): string {
    const requested = this.determineExtension(key, {
      metadata,
      defaultExtension: this.defaultFileExtension,
    });
    if (requested && this.serializerRegistry[requested]) {
      return requested;
    }
    return this.defaultFileExtension;
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-11'),
      fileExtensions: {
        supported: true,
        description: 'Supports any file extension that is supported by this filesystem',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over directory listings; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
      changes: {
        supported: true,
        description: 'Live change notifications via a recursive fs.watch on the root directory. '
          + 'No historical sync token or change feed (getSyncToken/listChanges are unsupported).',
        syncToken: false,
        changeFeed: false,
        subscription: true,
      },
    });
  }

  /**
   * Subscribe to live filesystem changes under `options.folder` (or the whole
   * root when omitted). Lazily starts a single recursive `fs.watch` shared by
   * all subscribers; the returned {@link Unsubscribe} removes this listener and
   * closes the watch handle once the last subscriber leaves.
   *
   * Emissions are debounced by {@link CHANGE_DEBOUNCE_MS} and coalesced by key,
   * so a burst of writes to one file yields a single {@link ChangeSummary}. The
   * `deleted` flag is resolved by `stat`ing the path at flush time (missing →
   * `deleted: true`); a rename surfaces as a delete of the old key plus an add
   * of the new key.
   */
  override subscribeChanges(
    options: SubscribeChangesOptions,
    listener: ChangeListener,
  ): Unsubscribe {
    this.changeSubscriptions.set(listener, options);
    this.ensureWatcher();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.changeSubscriptions.delete(listener);
      if (this.changeSubscriptions.size === 0) this.stopWatcher();
    };
  }

  private ensureWatcher(): void {
    if (this.watcher) return;
    this.watcher = watch(
      this.rootDirectory,
      { recursive: true },
      (_eventType, filename) => {
        if (filename === null) return;
        this.enqueueChange(filename);
      },
    );
  }

  private stopWatcher(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.pendingChanges.clear();
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }

  /** Normalize a raw watch filename to a repo-relative POSIX path and queue it. */
  private enqueueChange(rawRelPath: string): void {
    const relPath = rawRelPath.split(path.sep).join('/');
    if (relPath === '') return;
    // Drop ignoreList matches, reusing the same exclude filter as listings.
    if (this.excludeFilter.some(pattern => pattern.test(relPath))) return;
    const key = this.keyFromRelPath(relPath);
    this.pendingChanges.set(key, relPath);
    this.scheduleFlush();
  }

  /** Strip a trailing registered-serializer extension to recover the key. */
  private keyFromRelPath(relPath: string): string {
    for (const ext of Object.keys(this.serializerRegistry)) {
      if (relPath.endsWith(`.${ext}`)) return relPath.slice(0, -(ext.length + 1));
    }
    return relPath;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushChanges();
    }, CHANGE_DEBOUNCE_MS);
    this.flushTimer.unref();
  }

  private async flushChanges(): Promise<void> {
    if (this.pendingChanges.size === 0) return;
    const pending = this.pendingChanges;
    this.pendingChanges = new Map();

    const changes: ChangeSummary[] = [];
    for (const [key, relPath] of pending) {
      let deleted = false;
      try {
        await fs.stat(path.join(this.rootDirectory, relPath));
      } catch {
        deleted = true;
      }
      changes.push({ key, deleted });
    }
    if (changes.length === 0) return;

    for (const [listener, options] of this.changeSubscriptions) {
      const scoped = options.folder === undefined
        ? changes
        : changes.filter(change => change.key === options.folder || change.key.startsWith(`${options.folder}/`));
      if (scoped.length > 0) listener(scoped);
    }
  }
}
