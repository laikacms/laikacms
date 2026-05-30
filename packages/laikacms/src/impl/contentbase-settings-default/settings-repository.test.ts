import * as Result from 'effect/Result';
import type { ContentBaseSettings } from 'laikacms/contentbase-settings';
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
import { beforeEach, describe, expect, it } from 'vitest';
import { DefaultContentBaseSettingsProvider } from './settings-repository.js';

// ---- memory storage mock ----

function makeStorageObject(key: string, content: Record<string, unknown>): StorageObject {
  const now = new Date().toISOString();
  return { type: 'object', key, content, createdAt: now, updatedAt: now };
}

function makeMemoryStorage(initial?: Map<string, StorageObject>): StorageRepository {
  const store: Map<string, StorageObject> = initial ?? new Map();

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

// ---- tests ----

describe('DefaultContentBaseSettingsProvider', () => {
  let storage: StorageRepository;
  let provider: DefaultContentBaseSettingsProvider;

  beforeEach(() => {
    storage = makeMemoryStorage();
    provider = new DefaultContentBaseSettingsProvider({ storage });
  });

  describe('getSettings', () => {
    it('returns default settings when no settings file exists', async () => {
      const result = await provider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        // default settings file has no collections defined (empty object or undefined)
        expect(result.success).toBeDefined();
      }
    });

    it('returns persisted settings when a settings file exists', async () => {
      const existingSettings: ContentBaseSettings = {
        collections: {
          articles: {
            type: 'document',
            key: 'articles',
            name: 'Articles',
            directory: 'articles',
          },
        },
      };
      // Pre-populate the storage with a settings file
      const populatedStorage = makeMemoryStorage(
        new Map([['.contentbase/settings', {
          type: 'object',
          key: '.contentbase/settings',
          content: existingSettings,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }]]),
      );
      const populatedProvider = new DefaultContentBaseSettingsProvider({ storage: populatedStorage });
      const result = await populatedProvider.getSettings();
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.collections?.['articles']?.name).toBe('Articles');
      }
    });
  });

  describe('putSettings', () => {
    it('stores settings and retrieves them afterwards', async () => {
      const settings: ContentBaseSettings = {
        collections: {
          blog: {
            type: 'document',
            key: 'blog',
            name: 'Blog',
            directory: 'blog',
          },
        },
      };

      const putResult = await provider.putSettings(settings);
      expect(Result.isSuccess(putResult)).toBe(true);

      const getResult = await provider.getSettings();
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.collections?.['blog']?.name).toBe('Blog');
      }
    });
  });

  describe('getDocumentCollectionSettings', () => {
    it('returns default settings for unknown collection', async () => {
      const result = await provider.getDocumentCollectionSettings('posts');
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.type).toBe('document');
        expect(result.success.key).toBe('posts');
      }
    });

    it('returns configured settings for known document collection', async () => {
      await provider.putSettings({
        collections: {
          news: {
            type: 'document',
            key: 'news',
            name: 'News Articles',
            directory: 'news-content',
          },
        },
      });

      const result = await provider.getDocumentCollectionSettings('news');
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.name).toBe('News Articles');
        expect(result.success.directory).toBe('news-content');
      }
    });

    it('returns error when collection is of wrong type (media)', async () => {
      await provider.putSettings({
        collections: {
          images: {
            type: 'media',
            key: 'images',
            name: 'Images',
          },
        },
      });

      const result = await provider.getDocumentCollectionSettings('images');
      expect(Result.isFailure(result)).toBe(true);
    });
  });

  describe('putDocumentCollectionSettings', () => {
    it('saves and retrieves document collection settings', async () => {
      const collectionSettings: import('laikacms/contentbase-settings').DocumentCollectionSettings = {
        type: 'document',
        key: 'events',
        name: 'Events',
        directory: 'events',
        unpublishedStatuses: {
          draft: { directory: 'draft', name: 'Draft' },
        },
      };

      const putResult = await provider.putDocumentCollectionSettings('events', collectionSettings);
      expect(Result.isSuccess(putResult)).toBe(true);

      const getResult = await provider.getDocumentCollectionSettings('events');
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.name).toBe('Events');
      }
    });
  });

  describe('getCollectionSettings', () => {
    it('returns default document settings for unknown collection', async () => {
      const result = await provider.getCollectionSettings('anything');
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.type).toBe('document');
      }
    });
  });
});
