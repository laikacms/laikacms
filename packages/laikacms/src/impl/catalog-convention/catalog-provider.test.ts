import * as Result from 'effect/Result';
import type { JSONSchema7 } from 'json-schema';
import type { Catalog, DocumentCollectionSettings, MediaCollectionSettings } from 'laikacms/catalog';
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
import { ConventionCatalogProvider } from './catalog-provider.js';

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

describe('ConventionCatalogProvider', () => {
  let storage: StorageRepository;
  let provider: ConventionCatalogProvider;

  beforeEach(() => {
    storage = makeMemoryStorage();
    provider = new ConventionCatalogProvider({ storage });
  });

  describe('getCatalog', () => {
    it('returns default settings when no settings file exists', async () => {
      const result = await LaikaTask.runPromiseResult(provider.getCatalog());
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        // default settings file has no collections defined (empty object or undefined)
        expect(result.success).toBeDefined();
      }
    });

    it('returns persisted settings when a settings file exists', async () => {
      const existingSettings: Catalog = {
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
        new Map([['.laika/catalog', {
          type: 'object',
          key: '.laika/catalog',
          content: existingSettings,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }]]),
      );
      const populatedProvider = new ConventionCatalogProvider({ storage: populatedStorage });
      const result = await LaikaTask.runPromiseResult(populatedProvider.getCatalog());
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.collections?.['articles']?.name).toBe('Articles');
      }
    });
  });

  describe('putCatalog', () => {
    it('stores settings and retrieves them afterwards', async () => {
      const settings: Catalog = {
        collections: {
          blog: {
            type: 'document',
            key: 'blog',
            name: 'Blog',
            directory: 'blog',
          },
        },
      };

      const putResult = await LaikaTask.runPromiseResult(provider.putCatalog(settings));
      expect(Result.isSuccess(putResult)).toBe(true);

      const getResult = await LaikaTask.runPromiseResult(provider.getCatalog());
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.collections?.['blog']?.name).toBe('Blog');
      }
    });
  });

  describe('getDocumentCollectionSettings', () => {
    it('returns default settings for unknown collection', async () => {
      const result = await LaikaTask.runPromiseResult(provider.getDocumentCollectionSettings('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.type).toBe('document');
        expect(result.success.key).toBe('posts');
      }
    });

    it('includes unpublishedStatuses with standard statuses by default (LCMS-267)', async () => {
      const result = await LaikaTask.runPromiseResult(provider.getDocumentCollectionSettings('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        const statuses = result.success.unpublishedStatuses;
        expect(statuses).toBeDefined();
        expect(Object.keys(statuses!)).toContain('draft');
        expect(Object.keys(statuses!)).toContain('archived');
        expect(Object.keys(statuses!)).toContain('trash');
      }
    });

    it('returns configured settings for known document collection', async () => {
      await LaikaTask.runPromiseResult(provider.putCatalog({
        collections: {
          news: {
            type: 'document',
            key: 'news',
            name: 'News Articles',
            directory: 'news-content',
          },
        },
      }));

      const result = await LaikaTask.runPromiseResult(provider.getDocumentCollectionSettings('news'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.name).toBe('News Articles');
        expect(result.success.directory).toBe('news-content');
      }
    });

    it('returns error when collection is of wrong type (media)', async () => {
      await LaikaTask.runPromiseResult(provider.putCatalog({
        collections: {
          images: {
            type: 'media',
            key: 'images',
            name: 'Images',
          },
        },
      }));

      const result = await LaikaTask.runPromiseResult(provider.getDocumentCollectionSettings('images'));
      expect(Result.isFailure(result)).toBe(true);
    });
  });

  describe('putDocumentCollectionSettings', () => {
    it('saves and retrieves document collection settings', async () => {
      const collectionSettings: DocumentCollectionSettings = {
        type: 'document',
        key: 'events',
        name: 'Events',
        directory: 'events',
        unpublishedStatuses: {
          draft: { directory: 'draft', name: 'Draft' },
        },
      };

      const putResult = await LaikaTask.runPromiseResult(
        provider.putDocumentCollectionSettings('events', collectionSettings),
      );
      expect(Result.isSuccess(putResult)).toBe(true);

      const getResult = await LaikaTask.runPromiseResult(provider.getDocumentCollectionSettings('events'));
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.name).toBe('Events');
      }
    });
  });

  describe('getMediaCollectionSettings', () => {
    it('returns default settings for unknown collection', async () => {
      const result = await LaikaTask.runPromiseResult(provider.getMediaCollectionSettings('uploads'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.type).toBe('media');
        expect(result.success.key).toBe('uploads');
        expect(result.success.name).toBe('Uploads');
      }
    });

    it('returns configured settings for known media collection', async () => {
      const settings: MediaCollectionSettings = {
        type: 'media',
        key: 'photos',
        name: 'Photos',
        directory: 'public/photos',
        recursive: false,
        accept: ['image/png', 'image/jpeg'],
      };
      await LaikaTask.runPromiseResult(provider.putMediaCollectionSettings('photos', settings));

      const result = await LaikaTask.runPromiseResult(provider.getMediaCollectionSettings('photos'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.name).toBe('Photos');
        expect(result.success.directory).toBe('public/photos');
        expect(result.success.recursive).toBe(false);
      }
    });

    it('returns failure when collection exists as document type', async () => {
      await LaikaTask.runPromiseResult(provider.putCatalog({
        collections: {
          articles: {
            type: 'document',
            key: 'articles',
            name: 'Articles',
            directory: 'articles',
          },
        },
      }));

      const result = await LaikaTask.runPromiseResult(provider.getMediaCollectionSettings('articles'));
      expect(Result.isFailure(result)).toBe(true);
    });
  });

  describe('putMediaCollectionSettings', () => {
    it('round-trips: put then get returns the same settings', async () => {
      const settings: MediaCollectionSettings = {
        type: 'media',
        key: 'assets',
        name: 'Assets',
        directory: 'public/assets',
        recursive: true,
        url: 'https://cdn.example.com/{filename}',
      };

      const putResult = await LaikaTask.runPromiseResult(
        provider.putMediaCollectionSettings('assets', settings),
      );
      expect(Result.isSuccess(putResult)).toBe(true);

      const getResult = await LaikaTask.runPromiseResult(provider.getMediaCollectionSettings('assets'));
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.name).toBe('Assets');
        expect(getResult.success.directory).toBe('public/assets');
        expect(getResult.success.url).toBe('https://cdn.example.com/{filename}');
      }
    });

    it('does not overwrite sibling collections', async () => {
      const docSettings: DocumentCollectionSettings = {
        type: 'document',
        key: 'posts',
        name: 'Posts',
        directory: 'content/posts',
      };
      await LaikaTask.runPromiseResult(provider.putDocumentCollectionSettings('posts', docSettings));

      const mediaSettings: MediaCollectionSettings = {
        type: 'media',
        key: 'images',
        name: 'Images',
        directory: 'public/images',
      };
      await LaikaTask.runPromiseResult(provider.putMediaCollectionSettings('images', mediaSettings));

      const docResult = await LaikaTask.runPromiseResult(provider.getDocumentCollectionSettings('posts'));
      expect(Result.isSuccess(docResult)).toBe(true);
      if (Result.isSuccess(docResult)) {
        expect(docResult.success.name).toBe('Posts');
      }
    });
  });

  describe('getCollectionSchema', () => {
    it('returns the stored JSON Schema', async () => {
      const schema: JSONSchema7 = {
        type: 'object',
        properties: {
          title: { type: 'string' },
          published: { type: 'boolean' },
        },
        required: ['title'],
      };
      await LaikaTask.runPromiseResult(provider.putCollectionSchema('posts', schema));

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.type).toBe('object');
        expect((result.success.properties as Record<string, unknown>)?.['title']).toEqual({ type: 'string' });
        expect(result.success.required).toContain('title');
      }
    });

    it('returns NotFoundError for unknown collection', async () => {
      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('nonexistent'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('putCollectionSchema', () => {
    it('round-trips: put then get returns the same schema object', async () => {
      const schema: JSONSchema7 = {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          body: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['slug', 'body'],
      };

      const putResult = await LaikaTask.runPromiseResult(
        provider.putCollectionSchema('articles', schema),
      );
      expect(Result.isSuccess(putResult)).toBe(true);

      const getResult = await LaikaTask.runPromiseResult(provider.getCollectionSchema('articles'));
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.type).toBe('object');
        const props = getResult.success.properties as Record<string, unknown>;
        expect(props?.['slug']).toEqual({ type: 'string' });
        expect(props?.['tags']).toEqual({ type: 'array', items: { type: 'string' } });
        expect(getResult.success.required).toContain('slug');
        expect(getResult.success.required).toContain('body');
      }
    });

    it('overwrites an existing schema for the same collection', async () => {
      const v1: JSONSchema7 = { type: 'object', properties: { title: { type: 'string' } } };
      await LaikaTask.runPromiseResult(provider.putCollectionSchema('posts', v1));

      const v2: JSONSchema7 = { type: 'object', properties: { headline: { type: 'string' } } };
      await LaikaTask.runPromiseResult(provider.putCollectionSchema('posts', v2));

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        const props = result.success.properties as Record<string, unknown>;
        expect(props?.['headline']).toEqual({ type: 'string' });
        expect(props?.['title']).toBeUndefined();
      }
    });
  });
});
