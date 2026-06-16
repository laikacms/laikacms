import { EntryAlreadyExistsError, LaikaStream, LaikaTask } from 'laikacms/core';
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
} from 'laikacms/storage';
import { CompatibilityDate, StorageRepository } from 'laikacms/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateStorage } from './migrate.js';

// ---------------------------------------------------------------------------
// Minimal in-memory storage repository stub
// ---------------------------------------------------------------------------

class StubStorageRepository extends StorageRepository {
  private readonly objects = new Map<string, StorageObject>();
  private readonly explicitFolders = new Set<string>();

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-11'),
      fileExtensions: { supported: false, description: '' },
      pagination: { supported: false, description: '', styles: { offset: false, page: false, cursor: false } },
    } as Capabilities);
  }

  seed(key: string, content: Record<string, unknown> = {}): this {
    const now = new Date().toISOString();
    this.objects.set(key, { type: 'object', key, content, createdAt: now, updatedAt: now } as StorageObject);
    return this;
  }

  seedFolder(key: string): this {
    this.explicitFolders.add(key);
    return this;
  }

  hasObject(key: string): boolean {
    return this.objects.has(key);
  }

  objectCount(): number {
    return this.objects.size;
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    const v = this.objects.get(key);
    if (!v) return LaikaTask.fail(new Error(`Not found: ${key}`) as never);
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
    if (!existing) return LaikaTask.fail(new Error(`Not found: ${update.key}`) as never);
    const updated: StorageObject = {
      ...existing,
      content: (update.content ?? existing.content) as StorageObject['content'],
      updatedAt: new Date().toISOString(),
    };
    this.objects.set(update.key, updated);
    return LaikaTask.succeed(updated);
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    const removed: string[] = [];
    let skipped = 0;
    for (const key of keys) {
      if (this.objects.delete(key) || this.explicitFolders.delete(key)) removed.push(key);
      else skipped += 1;
    }
    return removed.length > 0
      ? LaikaStream.succeedMany<string, RemoveAtomsDone>(removed, { removed: removed.length, skipped })
      : LaikaStream.empty<RemoveAtomsDone>({ removed: 0, skipped });
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    const exists = this.explicitFolders.has(key)
      || [...this.objects.keys()].some(k => k.startsWith(`${key}/`));
    if (!exists) return LaikaTask.fail(new Error(`Folder not found: ${key}`) as never);
    const now = new Date().toISOString();
    return LaikaTask.succeed({ type: 'folder', key, createdAt: now, updatedAt: now } as Folder);
  }

  createFolder(create: FolderCreate): LaikaTask.LaikaTask<Folder> {
    if (this.explicitFolders.has(create.key)) {
      return LaikaTask.fail(new EntryAlreadyExistsError(`Already exists: ${create.key}`));
    }
    this.explicitFolders.add(create.key);
    const now = new Date().toISOString();
    return LaikaTask.succeed({ type: 'folder', key: create.key, createdAt: now, updatedAt: now } as Folder);
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    const obj = this.objects.get(key);
    if (obj) return LaikaTask.succeed(obj as Atom);
    const now = new Date().toISOString();
    if (this.explicitFolders.has(key)) {
      return LaikaTask.succeed({ type: 'folder', key, createdAt: now, updatedAt: now } as Atom);
    }
    return LaikaTask.fail(new Error(`Not found: ${key}`) as never);
  }

  listAtoms(folderKey: string, _options: ListAtomsOptions): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return this.listAtomSummaries(folderKey, _options) as unknown as LaikaStream.LaikaStream<Atom, ListAtomsDone>;
  }

  listAtomSummaries(
    folderKey: string,
    _options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    const prefix = folderKey ? (folderKey.endsWith('/') ? folderKey : `${folderKey}/`) : '';
    const summaries: AtomSummary[] = [];
    for (const [k, v] of this.objects.entries()) {
      if (!prefix || k.startsWith(prefix)) {
        summaries.push({
          type: 'object-summary',
          key: v.key,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
        } as AtomSummary);
      }
    }
    return summaries.length > 0
      ? LaikaStream.succeedMany<AtomSummary, ListAtomsDone>(summaries, { total: summaries.length })
      : LaikaStream.empty<ListAtomsDone>({ total: 0 });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migrateStorage', () => {
  let source: StubStorageRepository;
  let destination: StubStorageRepository;

  beforeEach(() => {
    source = new StubStorageRepository();
    destination = new StubStorageRepository();
  });

  it('copies objects from source to destination', async () => {
    source.seed('docs/a.md').seed('docs/b.md');

    const result = await migrateStorage(source, destination);

    expect(result.objectsCopied).toBe(2);
    expect(result.objectsSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(destination.hasObject('docs/a.md')).toBe(true);
    expect(destination.hasObject('docs/b.md')).toBe(true);
  });

  it('dry-run skips all writes and reports objectsSkipped', async () => {
    source.seed('foo/bar.md').seed('foo/baz.md');

    const result = await migrateStorage(source, destination, { dryRun: true });

    expect(result.objectsCopied).toBe(0);
    expect(result.objectsSkipped).toBe(2);
    expect(destination.objectCount()).toBe(0);
  });

  it('dry-run emits object-skipped events with reason dry-run', async () => {
    source.seed('item.md');
    const events: string[] = [];

    await migrateStorage(source, destination, {
      dryRun: true,
      onEvent: e => events.push(e.type),
    });

    expect(events).toContain('object-skipped');
  });

  it('overwrite=false skips existing destination objects with EntryAlreadyExistsError', async () => {
    source.seed('file.md', { body: 'new' });
    destination.seed('file.md', { body: 'old' });

    const result = await migrateStorage(source, destination, { overwrite: false });

    expect(result.objectsSkipped).toBe(1);
    expect(result.objectsCopied).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('overwrite=false emits object-skipped with reason exists', async () => {
    source.seed('file.md');
    destination.seed('file.md');
    const events: Array<{ type: string, reason?: string }> = [];

    await migrateStorage(source, destination, {
      overwrite: false,
      onEvent: e => events.push(e),
    });

    const skipped = events.find(e => e.type === 'object-skipped');
    expect(skipped).toBeDefined();
    expect((skipped as { reason?: string })?.reason).toBe('exists');
  });

  it('overwrite=true replaces existing destination objects', async () => {
    source.seed('file.md', { body: 'updated' });
    destination.seed('file.md', { body: 'original' });

    const result = await migrateStorage(source, destination, { overwrite: true });

    expect(result.objectsCopied).toBe(1);
    expect(result.objectsSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('records errors when getObject throws unexpectedly', async () => {
    // Seed the source so listAtomSummaries returns 'broken.md'…
    source.seed('broken.md');
    // …then make getObject throw for that key specifically
    vi.spyOn(source, 'getObject').mockImplementation((key: string) => {
      return LaikaTask.fail(new Error('disk read error') as never);
    });

    const result = await migrateStorage(source, destination);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toContain('disk read error');
  });

  it('emits error event when write fails unexpectedly', async () => {
    source.seed('oops.md');
    vi.spyOn(destination, 'createObject').mockImplementation(() => {
      return LaikaTask.fail(new Error('write failure') as never);
    });
    const errorEvents: Array<{ type: string, key: string }> = [];

    const result = await migrateStorage(source, destination, {
      onEvent: e => {
        if (e.type === 'error') errorEvents.push(e);
      },
    });

    expect(errorEvents).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('write failure');
  });

  it('returns empty result for empty source', async () => {
    const result = await migrateStorage(source, destination);

    expect(result.objectsCopied).toBe(0);
    expect(result.objectsSkipped).toBe(0);
    expect(result.foldersCreated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('emits object-copied event for each copied object', async () => {
    source.seed('a.md').seed('b.md');
    const copied: string[] = [];

    await migrateStorage(source, destination, {
      onEvent: e => {
        if (e.type === 'object-copied') copied.push(e.key);
      },
    });

    expect(copied).toEqual(expect.arrayContaining(['a.md', 'b.md']));
  });

  it('respects the from option and only migrates objects under that key', async () => {
    source.seed('alpha/x.md').seed('beta/y.md');

    const result = await migrateStorage(source, destination, { from: 'alpha' });

    expect(destination.hasObject('alpha/x.md')).toBe(true);
    expect(destination.hasObject('beta/y.md')).toBe(false);
    expect(result.objectsCopied).toBe(1);
  });
});
