import { EntryAlreadyExistsError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type { AtomSummary, Key, StorageObject, StorageRepository } from 'laikacms/storage';

/**
 * Why a folder/object was skipped during a migration run.
 */
export type MigrateSkipReason = 'dry-run' | 'exists';

/**
 * Per-item events emitted during a migration. Consumers can wire these to a
 * progress bar or a structured log.
 */
export type MigrateEvent =
  | { readonly type: 'folder-discovered', readonly key: Key }
  | { readonly type: 'folder-created', readonly key: Key }
  | { readonly type: 'folder-skipped', readonly key: Key, readonly reason: MigrateSkipReason }
  | { readonly type: 'object-copied', readonly key: Key }
  | { readonly type: 'object-skipped', readonly key: Key, readonly reason: MigrateSkipReason }
  | { readonly type: 'error', readonly key: Key, readonly error: Error };

export interface MigrateStorageOptions {
  /** Folder key to start the migration from. Defaults to '' (the source root). */
  readonly from?: Key;
  /**
   * When `true`, use `createOrUpdateObject` on the destination so existing
   * objects are overwritten. When `false` (default), `createObject` is used and
   * already-existing destination objects are reported as `object-skipped`.
   */
  readonly overwrite?: boolean;
  /**
   * When `true`, no writes happen on the destination. Every would-be copy is
   * reported as `object-skipped` / `folder-skipped` with reason `'dry-run'`.
   */
  readonly dryRun?: boolean;
  /**
   * Page size used when listing folders on the source. Defaults to 1000. Most
   * filesystem-backed repositories return the full directory in a single page,
   * but cursor-style backends benefit from a sensible page size.
   */
  readonly pageSize?: number;
  /**
   * Maximum number of objects copied in parallel within a single folder.
   * Defaults to 4. Folders are still walked sequentially.
   */
  readonly concurrency?: number;
  /** Receives every {@link MigrateEvent} as it happens. */
  readonly onEvent?: (event: MigrateEvent) => void;
}

export interface MigrateStorageResult {
  readonly foldersCreated: number;
  readonly foldersSkipped: number;
  readonly objectsCopied: number;
  readonly objectsSkipped: number;
  readonly errors: ReadonlyArray<{ readonly key: Key, readonly message: string }>;
}

/**
 * Copy every atom under `options.from` from `source` to `destination`.
 *
 * Walks the source breadth-first using `listAtomSummaries` with a page-based
 * pagination loop, so the algorithm works against any `StorageRepository`
 * regardless of whether it honors the abstract `depth` parameter. Object copies
 * within a folder fan out up to `options.concurrency` at a time; sibling folders
 * are walked sequentially to keep memory bounded and progress events ordered.
 *
 * Per-item failures (a single object read failure, a destination write
 * conflict) are recorded in `errors` and emitted as `error` events but never
 * abort the whole migration. The returned promise rejects only on programmer
 * errors (e.g. bad arguments).
 */
export const migrateStorage = async (
  source: StorageRepository,
  destination: StorageRepository,
  options: MigrateStorageOptions = {},
): Promise<MigrateStorageResult> => {
  const from = options.from ?? '';
  const overwrite = options.overwrite ?? false;
  const dryRun = options.dryRun ?? false;
  const pageSize = Math.max(1, options.pageSize ?? 1000);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const emit = options.onEvent ?? (() => {});

  const result = {
    foldersCreated: 0,
    foldersSkipped: 0,
    objectsCopied: 0,
    objectsSkipped: 0,
    errors: [] as { key: Key, message: string }[],
  };

  const recordError = (key: Key, err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    result.errors.push({ key, message: error.message });
    emit({ type: 'error', key, error });
  };

  const copyObject = async (key: Key) => {
    let object: StorageObject;
    try {
      object = await LaikaTask.runPromise(source.getObject(key));
    } catch (err) {
      recordError(key, err);
      return;
    }

    if (dryRun) {
      result.objectsSkipped += 1;
      emit({ type: 'object-skipped', key, reason: 'dry-run' });
      return;
    }

    const create = {
      type: 'object' as const,
      key,
      content: object.content,
      metadata: object.metadata,
    };

    try {
      if (overwrite) {
        await LaikaTask.runPromise(destination.createOrUpdateObject(create));
      } else {
        await LaikaTask.runPromise(destination.createObject(create));
      }
      result.objectsCopied += 1;
      emit({ type: 'object-copied', key });
    } catch (err) {
      if (err instanceof EntryAlreadyExistsError) {
        result.objectsSkipped += 1;
        emit({ type: 'object-skipped', key, reason: 'exists' });
        return;
      }
      recordError(key, err);
    }
  };

  const ensureFolder = async (key: Key) => {
    if (key === '') return;
    if (dryRun) {
      result.foldersSkipped += 1;
      emit({ type: 'folder-skipped', key, reason: 'dry-run' });
      return;
    }
    try {
      await LaikaTask.runPromise(destination.createFolder({ type: 'folder', key }));
      result.foldersCreated += 1;
      emit({ type: 'folder-created', key });
    } catch (err) {
      if (err instanceof EntryAlreadyExistsError) {
        result.foldersSkipped += 1;
        emit({ type: 'folder-skipped', key, reason: 'exists' });
        return;
      }
      recordError(key, err);
    }
  };

  const listFolder = async (folderKey: Key): Promise<AtomSummary[]> => {
    const all: AtomSummary[] = [];
    let page = 1;
    while (true) {
      const { data, recoverableErrors } = await LaikaStream.runPromiseCollect(
        source.listAtomSummaries(folderKey, {
          depth: 0,
          pagination: { page, perPage: pageSize },
        }),
      );
      for (const err of recoverableErrors) {
        if (err instanceof NotFoundError) continue;
        recordError(folderKey, err);
      }
      all.push(...data);
      if (data.length < pageSize) break;
      page += 1;
    }
    return all;
  };

  const runWithConcurrency = async <T>(
    items: ReadonlyArray<T>,
    worker: (item: T) => Promise<void>,
  ): Promise<void> => {
    let i = 0;
    const next = async (): Promise<void> => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx]!);
      }
    };
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(concurrency, items.length); w++) workers.push(next());
    await Promise.all(workers);
  };

  const queue: Key[] = [from];
  while (queue.length > 0) {
    const folderKey = queue.shift()!;
    let summaries: AtomSummary[];
    try {
      summaries = await listFolder(folderKey);
    } catch (err) {
      recordError(folderKey, err);
      continue;
    }

    const folders: Key[] = [];
    const objects: Key[] = [];
    for (const s of summaries) {
      if (s.type === 'folder-summary') folders.push(s.key);
      else objects.push(s.key);
    }

    // Empty source folder: explicitly create on destination so the structure is
    // preserved. Non-empty folders get auto-created when we write their objects.
    if (summaries.length === 0) await ensureFolder(folderKey);

    for (const child of folders) {
      emit({ type: 'folder-discovered', key: child });
      queue.push(child);
    }

    await runWithConcurrency(objects, copyObject);
  }

  return result;
};
