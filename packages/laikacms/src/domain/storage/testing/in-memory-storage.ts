import { EntryAlreadyExistsError, LaikaStream, LaikaTask, NotFoundError } from '../../../shared/core/index.js';

import type {
  Atom,
  AtomSummary,
  Capabilities,
  Folder,
  FolderCreate,
  ListAtomsDone,
  ListAtomsOptions,
  RemoveAtomsDone,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
} from '../index.js';
import { applyPagination, CompatibilityDate, StorageRepository, unsupportedChanges } from '../index.js';

/**
 * A `StorageRepository` backed by an in-memory `Map`. Intended for use as the
 * stub provider behind impls that compose a `StorageRepository` (e.g.
 * `documents-contentbase`, `assets-contentbase`) when running their contract
 * tests — those impls' "third-party" is the storage layer itself, so this
 * gives the contract a fast, leak-free backing without depending on the FS
 * impl's filename/extension semantics.
 *
 * Folders are tracked as a separate set of keys; non-empty folders are
 * also implied by the presence of any object whose key starts with `<folder>/`.
 */
export class InMemoryStorageRepository extends StorageRepository {
  private readonly objects = new Map<string, StorageObject>();
  private readonly folders = new Set<string>();

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-11'),
      fileExtensions: {
        supported: false,
        description: 'In-memory storage has no notion of file extensions.',
      },
      pagination: {
        supported: true,
        description: 'Naive in-memory slicing by offset/limit.',
        styles: { offset: true, page: true, cursor: false },
      },
      changes: unsupportedChanges,
    } as Capabilities);
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    const v = this.objects.get(key);
    if (!v) return LaikaTask.fail(new NotFoundError(`Not found: ${key}`));
    return LaikaTask.succeed(v);
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    if (this.objects.has(create.key)) {
      return LaikaTask.fail(new EntryAlreadyExistsError(`Already exists: ${create.key}`));
    }
    const now = new Date().toISOString();
    const obj: StorageObject = {
      type: 'object',
      key: create.key,
      content: (create.content ?? {}) as StorageObject['content'],
      createdAt: now,
      updatedAt: now,
    };
    this.objects.set(create.key, obj);
    return LaikaTask.succeed(obj);
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    const existing = this.objects.get(create.key);
    const now = new Date().toISOString();
    const obj: StorageObject = {
      type: 'object',
      key: create.key,
      content: (create.content ?? {}) as StorageObject['content'],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.objects.set(create.key, obj);
    return LaikaTask.succeed(obj);
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    const existing = this.objects.get(update.key);
    if (!existing) return LaikaTask.fail(new NotFoundError(`Not found: ${update.key}`));
    const updated: StorageObject = {
      ...existing,
      content: (update.content ?? existing.content) as StorageObject['content'],
      updatedAt: new Date().toISOString(),
    };
    this.objects.set(update.key, updated);
    return LaikaTask.succeed(updated);
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    const removedKeys: string[] = [];
    let skipped = 0;
    for (const key of keys) {
      if (this.objects.delete(key) || this.folders.delete(key)) removedKeys.push(key);
      else skipped += 1;
    }
    return removedKeys.length > 0
      ? LaikaStream.succeedMany<string, RemoveAtomsDone>(removedKeys, {
        removed: removedKeys.length,
        skipped,
      })
      : LaikaStream.empty<RemoveAtomsDone>({ removed: 0, skipped });
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    const exists = this.folders.has(key)
      || [...this.objects.keys()].some(k => k.startsWith(`${key}/`));
    if (!exists) return LaikaTask.fail(new NotFoundError(`Folder not found: ${key}`));
    const now = new Date().toISOString();
    return LaikaTask.succeed({ type: 'folder', key, createdAt: now, updatedAt: now } as Folder);
  }

  createFolder(create: FolderCreate): LaikaTask.LaikaTask<Folder> {
    this.folders.add(create.key);
    const now = new Date().toISOString();
    return LaikaTask.succeed({
      type: 'folder',
      key: create.key,
      createdAt: now,
      updatedAt: now,
    } as Folder);
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    const obj = this.objects.get(key);
    if (obj) return LaikaTask.succeed(obj as Atom);
    if (this.folders.has(key) || [...this.objects.keys()].some(k => k.startsWith(`${key}/`))) {
      const now = new Date().toISOString();
      return LaikaTask.succeed({ type: 'folder', key, createdAt: now, updatedAt: now } as Atom);
    }
    return LaikaTask.fail(new NotFoundError(`Atom not found: ${key}`));
  }

  listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    const prefix = folderKey ? (folderKey.endsWith('/') ? folderKey : folderKey + '/') : '';
    const maxDepth = (folderKey ? folderKey.split('/').length : 0) + options.depth;
    const all: Atom[] = [];
    for (const [k, v] of this.objects.entries()) {
      if (prefix && !k.startsWith(prefix)) continue;
      if (k.split('/').length > maxDepth) continue;
      all.push(v as Atom);
    }
    all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const total = all.length;
    const page = applyPagination(all, options.pagination);
    return page.length > 0
      ? LaikaStream.succeedMany(page, { total })
      : LaikaStream.empty({ total });
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    const prefix = folderKey ? (folderKey.endsWith('/') ? folderKey : folderKey + '/') : '';
    const maxDepth = (folderKey ? folderKey.split('/').length : 0) + options.depth;
    const all: AtomSummary[] = [];
    for (const [k, v] of this.objects.entries()) {
      if (prefix && !k.startsWith(prefix)) continue;
      if (k.split('/').length > maxDepth) continue;
      all.push({
        type: 'object-summary',
        key: v.key,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      } as AtomSummary);
    }
    all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const total = all.length;
    const page = applyPagination(all, options.pagination);
    return page.length > 0
      ? LaikaStream.succeedMany(page, { total })
      : LaikaStream.empty({ total });
  }
}
