import * as Effect from 'effect/Effect';
import { EntryAlreadyExistsError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { applyPagination, Capabilities, CompatibilityDate, StorageRepository } from 'laikacms/storage';
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
} from 'laikacms/storage';

type StoredEntry =
  | { type: 'object', content: StorageObjectContent, createdAt: string, updatedAt: string }
  | { type: 'folder', createdAt: string, updatedAt: string };

/** Collect atom summaries from the store, filtering by prefix and depth. */
function collectSummaries(
  store: ReadonlyMap<string, StoredEntry>,
  folderKey: string,
  options: ListAtomsOptions,
): AtomSummary[] {
  const prefix = folderKey.endsWith('/') ? folderKey : `${folderKey}/`;
  const summaries: AtomSummary[] = [];

  for (const [key, entry] of store) {
    if (!key.startsWith(prefix)) continue;
    const remainder = key.slice(prefix.length);
    // depth: 1 means only direct children (no slash in remainder)
    if (options.depth === 1 && remainder.includes('/')) continue;
    summaries.push(
      entry.type === 'folder'
        ? { type: 'folder-summary', key, createdAt: entry.createdAt, updatedAt: entry.updatedAt }
        : { type: 'object-summary', key, createdAt: entry.createdAt, updatedAt: entry.updatedAt },
    );
  }

  summaries.sort((a, b) => a.key.localeCompare(b.key));
  return applyPagination(summaries, options.pagination);
}

/**
 * Purely in-memory implementation of StorageRepository.
 *
 * Keys are stored verbatim — no extension stripping or path normalisation.
 * This makes it suitable as a faked backend for the shared contract tests.
 */
export class InMemoryStorageRepository extends StorageRepository {
  readonly store = new Map<string, StoredEntry>();

  private now(): string {
    return new Date().toISOString();
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-31'),
      fileExtensions: {
        supported: false,
        description: 'In-memory backend; keys are stored verbatim without extension handling.',
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing; offset pagination is supported.',
        styles: { offset: true, page: false, cursor: false },
      },
    });
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() => {
      if (this.store.has(create.key)) {
        return Effect.fail(
          new EntryAlreadyExistsError(`Object with key "${create.key}" already exists.`),
        );
      }
      const ts = this.now();
      this.store.set(create.key, {
        type: 'object',
        content: create.content,
        createdAt: ts,
        updatedAt: ts,
      });
      return Effect.succeed(
        {
          type: 'object',
          key: create.key,
          content: create.content,
          createdAt: ts,
          updatedAt: ts,
        } satisfies StorageObject,
      );
    });
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() => {
      const existing = this.store.get(create.key);
      const createdAt = existing?.createdAt ?? this.now();
      const updatedAt = this.now();
      this.store.set(create.key, {
        type: 'object',
        content: create.content,
        createdAt,
        updatedAt,
      });
      return Effect.succeed(
        {
          type: 'object',
          key: create.key,
          content: create.content,
          createdAt,
          updatedAt,
        } satisfies StorageObject,
      );
    });
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() => {
      const existing = this.store.get(update.key);
      if (!existing || existing.type !== 'object') {
        return Effect.fail(new NotFoundError(`Object with key "${update.key}" not found.`));
      }
      const updatedAt = this.now();
      const newContent = update.content ?? existing.content;
      this.store.set(update.key, {
        type: 'object',
        content: newContent,
        createdAt: existing.createdAt,
        updatedAt,
      });
      return Effect.succeed(
        {
          type: 'object',
          key: update.key,
          content: newContent,
          createdAt: existing.createdAt,
          updatedAt,
        } satisfies StorageObject,
      );
    });
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() => {
      const entry = this.store.get(key);
      if (!entry || entry.type !== 'object') {
        return Effect.fail(new NotFoundError(`Object with key "${key}" not found.`));
      }
      return Effect.succeed(
        {
          type: 'object',
          key,
          content: entry.content,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        } satisfies StorageObject,
      );
    });
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() => {
      const ts = this.now();
      this.store.set(folderCreate.key, { type: 'folder', createdAt: ts, updatedAt: ts });
      return Effect.succeed(
        {
          type: 'folder',
          key: folderCreate.key,
          createdAt: ts,
          updatedAt: ts,
        } satisfies Folder,
      );
    });
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() => {
      const entry = this.store.get(key);
      if (!entry || entry.type !== 'folder') {
        return Effect.fail(new NotFoundError(`Folder with key "${key}" not found.`));
      }
      return Effect.succeed(
        {
          type: 'folder',
          key,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        } satisfies Folder,
      );
    });
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() => {
      const entry = this.store.get(key);
      if (!entry) {
        return Effect.fail(new NotFoundError(`Atom with key "${key}" not found.`));
      }
      if (entry.type === 'folder') {
        return Effect.succeed(
          {
            type: 'folder',
            key,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          } satisfies Atom,
        );
      }
      return Effect.succeed(
        {
          type: 'object',
          key,
          content: entry.content,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        } satisfies Atom,
      );
    });
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    const store = this.store;
    return LaikaStream.make<AtomSummary, ListAtomsDone>(emit =>
      Effect.gen(function*() {
        const summaries = collectSummaries(store, folderKey, options);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total: summaries.length };
      })
    );
  }

  listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    const store = this.store;
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen(function*() {
        const summaries = collectSummaries(store, folderKey, options);
        for (const summary of summaries) {
          const entry = store.get(summary.key);
          if (!entry) continue;
          if (entry.type === 'folder') {
            yield* emit.data({
              type: 'folder',
              key: summary.key,
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
            });
          } else {
            yield* emit.data({
              type: 'object',
              key: summary.key,
              content: entry.content,
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
            });
          }
        }
        return { total: summaries.length };
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    const store = this.store;
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen(function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          if (store.has(key)) {
            store.delete(key);
            yield* emit.data(key);
            removed += 1;
          } else {
            yield* emit.recoverableError(
              new NotFoundError(`Key "${key}" not found; skipping removal.`),
            );
            skipped += 1;
          }
        }
        return { removed, skipped };
      })
    );
  }
}
