import type { ContentBaseSettings } from '@laikacms/contentbase-settings';
import { NotFoundError } from '@laikacms/core';
import type {
  Atom,
  AtomSummary,
  FolderCreate,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageRepository,
} from '@laikacms/storage';
import * as Result from 'effect/Result';
import { beforeEach, describe, expect, it } from 'vitest';
import { DefaultContentBaseSettingsProvider } from './settings-repository.js';

// ---- helpers ----

async function firstResult<T>(gen: AsyncGenerator<Result.Result<T, unknown>>): Promise<Result.Result<T, unknown>> {
  for await (const result of gen) return result;
  return Result.fail(new NotFoundError('No result from generator'));
}

// ---- memory storage mock ----

function makeStorageObject(key: string, content: Record<string, unknown>): StorageObject {
  const now = new Date().toISOString();
  return { type: 'object', key, content, createdAt: now, updatedAt: now };
}

function makeMemoryStorage(initial?: Map<string, StorageObject>): StorageRepository {
  const store: Map<string, StorageObject> = initial ?? new Map();

  return {
    async *getObject(key: string) {
      const v = store.get(key);
      if (!v) {
        yield Result.fail(new NotFoundError(`Not found: ${key}`));
        return;
      }
      yield Result.succeed(v);
    },

    async *createObject(create: StorageObjectCreate) {
      const obj = makeStorageObject(create.key, create.content ?? {});
      store.set(create.key, obj);
      yield Result.succeed(obj);
    },

    async *createOrUpdateObject(create: StorageObjectCreate) {
      const obj = makeStorageObject(create.key, create.content ?? {});
      store.set(create.key, obj);
      yield Result.succeed(obj);
    },

    async *updateObject(update: StorageObjectUpdate) {
      const existing = store.get(update.key);
      if (!existing) {
        yield Result.fail(new NotFoundError(`Not found: ${update.key}`));
        return;
      }
      const updated: StorageObject = {
        ...existing,
        content: update.content ?? existing.content,
        updatedAt: new Date().toISOString(),
      };
      store.set(update.key, updated);
      yield Result.succeed(updated);
    },

    async *removeAtoms(keys: readonly string[]) {
      for (const key of keys) store.delete(key);
      yield Result.succeed(keys as readonly string[]);
    },

    async *listAtoms(_folderKey: string, _options: unknown) {
      yield Result.succeed([] as readonly Atom[]);
    },

    async *listAtomSummaries(_folderKey: string, _options: unknown) {
      yield Result.succeed([] as readonly AtomSummary[]);
    },

    async *getFolder(_key: string) {
      yield Result.fail(new NotFoundError('not implemented'));
    },

    async *createFolder(_create: FolderCreate) {
      yield Result.fail(new NotFoundError('not implemented'));
    },

    async *getAtom(key: string) {
      const v = store.get(key);
      if (!v) {
        yield Result.fail(new NotFoundError(`Not found: ${key}`));
        return;
      }
      yield Result.succeed(v as Atom);
    },
  } as StorageRepository;
}

// ---- tests ----

describe('DefaultContentBaseSettingsProvider', () => {
  let storage: StorageRepository;
  let provider: DefaultContentBaseSettingsProvider;

  beforeEach(() => {
    storage = makeMemoryStorage();
    provider = new DefaultContentBaseSettingsProvider(storage);
  });

  describe('getSettings', () => {
    it('returns default settings when no settings file exists', async () => {
      const result = await firstResult(provider.getSettings());
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
        new Map([['.contentbase/settings.json', {
          type: 'object',
          key: '.contentbase/settings.json',
          content: existingSettings,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }]]),
      );
      const populatedProvider = new DefaultContentBaseSettingsProvider(populatedStorage);
      const result = await firstResult(populatedProvider.getSettings());
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect((result.success as ContentBaseSettings).collections?.['articles']?.name).toBe('Articles');
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

      const putResult = await firstResult(provider.putSettings(settings));
      expect(Result.isSuccess(putResult)).toBe(true);

      const getResult = await firstResult(provider.getSettings());
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect((getResult.success as ContentBaseSettings).collections?.['blog']?.name).toBe('Blog');
      }
    });
  });

  describe('getDocumentCollectionSettings', () => {
    it('returns default settings for unknown collection', async () => {
      const result = await firstResult(provider.getDocumentCollectionSettings('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect((result.success as { type: string, key: string }).type).toBe('document');
        expect((result.success as { type: string, key: string }).key).toBe('posts');
      }
    });

    it('returns configured settings for known document collection', async () => {
      await firstResult(provider.putSettings({
        collections: {
          news: {
            type: 'document',
            key: 'news',
            name: 'News Articles',
            directory: 'news-content',
          },
        },
      }));

      const result = await firstResult(provider.getDocumentCollectionSettings('news'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect((result.success as { name: string, directory: string }).name).toBe('News Articles');
        expect((result.success as { name: string, directory: string }).directory).toBe('news-content');
      }
    });

    it('returns error when collection is of wrong type (media)', async () => {
      await firstResult(provider.putSettings({
        collections: {
          images: {
            type: 'media',
            key: 'images',
            name: 'Images',
          },
        },
      }));

      const result = await firstResult(provider.getDocumentCollectionSettings('images'));
      expect(Result.isFailure(result)).toBe(true);
    });
  });

  describe('putDocumentCollectionSettings', () => {
    it('saves and retrieves document collection settings', async () => {
      const collectionSettings: import('@laikacms/contentbase-settings').DocumentCollectionSettings = {
        type: 'document',
        key: 'events',
        name: 'Events',
        directory: 'events',
        unpublishedStatuses: {
          draft: { directory: 'draft', name: 'Draft' },
        },
      };

      const putResult = await firstResult(provider.putDocumentCollectionSettings('events', collectionSettings));
      expect(Result.isSuccess(putResult)).toBe(true);

      const getResult = await firstResult(provider.getDocumentCollectionSettings('events'));
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect((getResult.success as { name: string }).name).toBe('Events');
      }
    });
  });

  describe('getCollectionSettings (via getDocumentCollectionSettings)', () => {
    it('returns default document settings for unknown collection', async () => {
      const result = await firstResult(provider.getDocumentCollectionSettings('anything'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect((result.success as { type: string }).type).toBe('document');
      }
    });
  });
});
