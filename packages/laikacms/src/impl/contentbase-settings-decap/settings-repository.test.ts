import * as Result from 'effect/Result';
import { defaultUnpublishedStatuses } from 'laikacms/contentbase-settings';
import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageRepository,
} from 'laikacms/storage';
import { describe, expect, it } from 'vitest';
import { DecapContentBaseSettingsProvider } from './settings-repository.js';

// ---- memory storage mock ----

function makeStorageObject(key: string, content: Record<string, unknown>): StorageObject {
  const now = new Date().toISOString();
  return { type: 'object', key, content, createdAt: now, updatedAt: now };
}

function makeDecapStorage(decapConfig: Record<string, unknown>): StorageRepository {
  const store = new Map<string, StorageObject>([
    ['config', makeStorageObject('config', decapConfig)],
  ]);

  return {
    getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
      const v = store.get(key);
      if (!v) return LaikaTask.fail(new NotFoundError(`Not found: ${key}`));
      return LaikaTask.succeed(v);
    },

    createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
      const obj = makeStorageObject(create.key, create.content ?? {});
      store.set(create.key, obj);
      return LaikaTask.succeed(obj);
    },

    createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
      const obj = makeStorageObject(create.key, create.content ?? {});
      store.set(create.key, obj);
      return LaikaTask.succeed(obj);
    },

    updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
      const existing = store.get(update.key);
      if (!existing) return LaikaTask.fail(new NotFoundError(`Not found: ${update.key}`));
      const updated: StorageObject = {
        ...existing,
        content: update.content ?? existing.content,
        updatedAt: new Date().toISOString(),
      };
      store.set(update.key, updated);
      return LaikaTask.succeed(updated);
    },

    removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, { removed: number, skipped: number }> {
      for (const key of keys) store.delete(key);
      return LaikaStream.empty({ removed: keys.length, skipped: 0 });
    },

    listAtoms(_folderKey: string, _options: unknown): LaikaStream.LaikaStream<Atom, object> {
      return LaikaStream.empty({});
    },

    listAtomSummaries(_folderKey: string, _options: unknown): LaikaStream.LaikaStream<AtomSummary, object> {
      return LaikaStream.empty({});
    },

    getFolder(_key: string): LaikaTask.LaikaTask<Folder> {
      return LaikaTask.fail(new NotFoundError('getFolder not implemented in mock'));
    },

    createFolder(_create: FolderCreate): LaikaTask.LaikaTask<Folder> {
      return LaikaTask.fail(new NotFoundError('createFolder not implemented in mock'));
    },

    getAtom(key: string): LaikaTask.LaikaTask<Atom> {
      const v = store.get(key);
      if (!v) return LaikaTask.fail(new NotFoundError(`Not found: ${key}`));
      return LaikaTask.succeed(v as Atom);
    },

    getCapabilities(): LaikaTask.LaikaTask<object> {
      return LaikaTask.succeed({
        fileExtensions: { supported: true, supportedExtensions: { json: 'application/json' } },
      });
    },
  } as unknown as StorageRepository;
}

function makeProvider(decapConfig: Record<string, unknown>): DecapContentBaseSettingsProvider {
  return new DecapContentBaseSettingsProvider({
    storage: makeDecapStorage(decapConfig),
    configKey: 'config',
  });
}

// ---- LCMS-163 + LCMS-164 tests ----

describe('DecapContentBaseSettingsProvider', () => {
  describe('LCMS-163: editorial workflow derived from publish_mode, not c.publish', () => {
    it('config without publish_mode → collections get no unpublishedStatuses', async () => {
      const provider = makeProvider({
        collections: [
          { name: 'posts', label: 'Posts', folder: 'content/posts', fields: [] },
        ],
      });

      const result = await provider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        const posts = result.success.collections?.['posts'];
        expect(posts).toBeDefined();
        expect(posts?.type).toBe('document');
        expect((posts as { unpublishedStatuses?: unknown }).unpublishedStatuses).toBeUndefined();
      }
    });

    it('config with publish_mode: editorial_workflow → collections get unpublishedStatuses', async () => {
      const provider = makeProvider({
        publish_mode: 'editorial_workflow',
        collections: [
          { name: 'posts', label: 'Posts', folder: 'content/posts', fields: [] },
        ],
      });

      const result = await provider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        const posts = result.success.collections?.['posts'];
        expect(posts).toBeDefined();
        expect((posts as { unpublishedStatuses?: unknown }).unpublishedStatuses).toBeDefined();
      }
    });

    it('c.publish: false does NOT disable unpublishedStatuses when editorial_workflow is active', async () => {
      const provider = makeProvider({
        publish_mode: 'editorial_workflow',
        collections: [
          {
            name: 'posts',
            label: 'Posts',
            folder: 'content/posts',
            fields: [],
            publish: false,
          },
        ],
      });

      const result = await provider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        const posts = result.success.collections?.['posts'];
        expect(posts).toBeDefined();
        // publish: false on collection should NOT suppress editorial workflow statuses
        expect((posts as { unpublishedStatuses?: unknown }).unpublishedStatuses).toBeDefined();
      }
    });

    it('config with publish_mode: simple → collections get no unpublishedStatuses', async () => {
      const provider = makeProvider({
        publish_mode: 'simple',
        collections: [
          { name: 'posts', label: 'Posts', folder: 'content/posts', fields: [] },
        ],
      });

      const result = await provider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        const posts = result.success.collections?.['posts'];
        expect((posts as { unpublishedStatuses?: unknown }).unpublishedStatuses).toBeUndefined();
      }
    });
  });

  describe('LCMS-164: all 5 default unpublished statuses injected', () => {
    it('editorial_workflow config injects all 5 statuses including archived and trash', async () => {
      const provider = makeProvider({
        publish_mode: 'editorial_workflow',
        collections: [
          { name: 'articles', folder: 'content/articles', fields: [] },
        ],
      });

      const result = await provider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        const articles = result.success.collections?.['articles'];
        const statuses = (articles as { unpublishedStatuses?: Record<string, unknown> }).unpublishedStatuses;
        expect(statuses).toBeDefined();

        // All 5 keys from defaultUnpublishedStatuses must be present
        const expectedKeys = Object.keys(defaultUnpublishedStatuses);
        expect(expectedKeys).toHaveLength(5);
        for (const key of expectedKeys) {
          expect(statuses).toHaveProperty(key);
        }

        // Explicitly verify archived and trash (the ones previously missing)
        expect(statuses).toHaveProperty('archived');
        expect(statuses).toHaveProperty('trash');
        expect(statuses?.['archived']).toEqual({ directory: 'archived', name: 'Archived' });
        expect(statuses?.['trash']).toEqual({ directory: 'trash', name: 'Trash' });
      }
    });

    it('injected statuses match defaultUnpublishedStatuses exactly', async () => {
      const provider = makeProvider({
        publish_mode: 'editorial_workflow',
        collections: [
          { name: 'blog', folder: 'blog', fields: [] },
        ],
      });

      const result = await provider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        const blog = result.success.collections?.['blog'];
        const statuses = (blog as { unpublishedStatuses?: Record<string, unknown> }).unpublishedStatuses;
        expect(statuses).toEqual(defaultUnpublishedStatuses);
      }
    });
  });

  describe('collection translation', () => {
    it('translates folder collection name and directory', async () => {
      const provider = makeProvider({
        collections: [
          { name: 'my_posts', label: 'My Posts', folder: 'content/my-posts', fields: [] },
        ],
      });

      const result = await provider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        const col = result.success.collections?.['my_posts'];
        expect(col).toBeDefined();
        expect(col?.type).toBe('document');
        expect(col?.name).toBe('My Posts');
        if (col?.type === 'document') {
          expect(col.directory).toBe('content/my-posts');
        }
      }
    });

    it('files collections are skipped (not folder collections)', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'pages',
            files: [{ name: 'home', label: 'Home', file: 'content/home.md', fields: [] }],
          },
        ],
      });

      const result = await provider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.collections?.['pages']).toBeUndefined();
      }
    });

    it('multiple collections in editorial_workflow all get unpublishedStatuses', async () => {
      const provider = makeProvider({
        publish_mode: 'editorial_workflow',
        collections: [
          { name: 'posts', folder: 'posts', fields: [] },
          { name: 'events', folder: 'events', fields: [] },
        ],
      });

      const result = await provider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        for (const key of ['posts', 'events']) {
          const col = result.success.collections?.[key];
          const statuses = (col as { unpublishedStatuses?: unknown }).unpublishedStatuses;
          expect(statuses).toBeDefined();
        }
      }
    });
  });
});
