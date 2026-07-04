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

function makeDecapStorage(decapConfig: Record<string, unknown>): StorageRepository {
  return makeMemoryStorage(
    new Map([
      ['config', makeStorageObject('config', decapConfig)],
    ]),
  );
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

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
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

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
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

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
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

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
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

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
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

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
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

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
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

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
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

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
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

  describe('getSettings — folder collection', () => {
    it('returns a document collection with key, name, and directory from a folder collection', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            label: 'Blog Posts',
            folder: 'content/posts',
            fields: [{ name: 'title', widget: 'string' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      const col = result.success.collections?.['posts'];
      expect(col).toBeDefined();
      expect(col?.type).toBe('document');
      expect(col?.key).toBe('posts');
      expect(col?.name).toBe('Blog Posts');
      if (col?.type === 'document') {
        expect(col.directory).toBe('content/posts');
      }
    });

    it('derives the collection name from the key when label is absent', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'articles',
            folder: 'content/articles',
            fields: [{ name: 'title', widget: 'string' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      const col = result.success.collections?.['articles'];
      expect(col?.name).toBe('Articles');
    });

    it('sets recursive=true when nested config is present', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'pages',
            folder: 'content/pages',
            nested: { depth: 3 },
            fields: [{ name: 'title', widget: 'string' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      const col = result.success.collections?.['pages'];
      if (col?.type === 'document') {
        expect(col.recursive).toBe(true);
      }
    });
  });

  describe('getSettings — file collection', () => {
    it('omits file collections (they have no folder, so they are not translated)', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'site_settings',
            files: [
              {
                name: 'general',
                label: 'General',
                file: 'content/settings/general.json',
                fields: [{ name: 'site_name', widget: 'string' }],
              },
            ],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getSettings());
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      // File collections are not translated — they don't appear in the result
      expect(result.success.collections?.['site_settings']).toBeUndefined();
    });
  });

  describe('getCollectionSchema — field type mapping', () => {
    it('maps string widget to JSON Schema string', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'title', widget: 'string' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.properties?.['title']).toEqual({ type: 'string' });
    });

    it('maps boolean widget to JSON Schema boolean', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'published', widget: 'boolean' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.properties?.['published']).toEqual({ type: 'boolean' });
    });

    it('maps number widget to JSON Schema number', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'views', widget: 'number' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.properties?.['views']).toEqual({ type: 'number' });
    });

    it('maps number widget with value_type=int to JSON Schema integer', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'count', widget: 'number', value_type: 'int' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.properties?.['count']).toEqual({ type: 'integer' });
    });

    it('maps date widget to JSON Schema string with format date', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'published_at', widget: 'date' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.properties?.['published_at']).toEqual({ type: 'string', format: 'date' });
    });

    it('maps datetime widget to JSON Schema string with format date-time', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'created_at', widget: 'datetime' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.properties?.['created_at']).toEqual({ type: 'string', format: 'date-time' });
    });

    it('maps object widget recursively', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [
              {
                name: 'meta',
                widget: 'object',
                fields: [{ name: 'author', widget: 'string' }],
              },
            ],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      const metaSchema = result.success.properties?.['meta'] as Record<string, unknown>;
      expect(metaSchema?.type).toBe('object');
      const metaProps = metaSchema?.properties as Record<string, unknown>;
      expect(metaProps?.['author']).toEqual({ type: 'string' });
    });

    it('maps list widget with fields to array of objects', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [
              {
                name: 'tags',
                widget: 'list',
                fields: [{ name: 'label', widget: 'string' }],
              },
            ],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      const tagsSchema = result.success.properties?.['tags'] as Record<string, unknown>;
      expect(tagsSchema?.type).toBe('array');
    });

    it('maps list widget without fields to array of strings', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'categories', widget: 'list' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      const catSchema = result.success.properties?.['categories'] as Record<string, unknown>;
      expect(catSchema?.type).toBe('array');
      expect(catSchema?.items).toEqual({ type: 'string' });
    });

    it('maps list widget with min/max constraints', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'images', widget: 'list', min: 1, max: 5 }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      const schema = result.success.properties?.['images'] as Record<string, unknown>;
      expect(schema?.minItems).toBe(1);
      expect(schema?.maxItems).toBe(5);
    });

    it('maps select widget with string options to enum', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [
              {
                name: 'status',
                widget: 'select',
                options: ['draft', 'published', 'archived'],
              },
            ],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      const schema = result.success.properties?.['status'] as Record<string, unknown>;
      expect(schema?.type).toBe('string');
      expect(schema?.enum).toEqual(['draft', 'published', 'archived']);
    });

    it('maps select widget with multiple=true to array', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [
              {
                name: 'tags',
                widget: 'select',
                multiple: true,
                options: ['tech', 'news', 'life'],
              },
            ],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      const schema = result.success.properties?.['tags'] as Record<string, unknown>;
      expect(schema?.type).toBe('array');
    });

    it('maps image widget to JSON Schema string', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'thumbnail', widget: 'image' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.properties?.['thumbnail']).toEqual({ type: 'string' });
    });

    it('falls back to empty schema ({}) for unknown widget type', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'custom_field', widget: 'some_unknown_widget_xyz' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      // Unknown widget → {} (additionalProperties permissive, no type constraint)
      const schema = result.success.properties?.['custom_field'];
      expect(schema).toBeDefined();
      // Must NOT have a restrictive type
      expect((schema as Record<string, unknown>)?.['type']).toBeUndefined();
    });

    it('marks fields without required=false as required', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [
              { name: 'title', widget: 'string' },
              { name: 'subtitle', widget: 'string', required: false },
            ],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.required).toContain('title');
      expect(result.success.required).not.toContain('subtitle');
    });

    it('returns NotFoundError for unknown collection', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            folder: 'content/posts',
            fields: [{ name: 'title', widget: 'string' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('nonexistent'));
      expect(Result.isFailure(result)).toBe(true);
    });

    it('returns InvalidData for file collection (no single schema)', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'site_settings',
            files: [
              {
                name: 'general',
                file: 'content/settings/general.json',
                fields: [{ name: 'title', widget: 'string' }],
              },
            ],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getCollectionSchema('site_settings'));
      expect(Result.isFailure(result)).toBe(true);
    });
  });

  describe('readOnly write guards', () => {
    it('putSettings returns failure with InvalidData message', async () => {
      const provider = makeProvider({ collections: [] });
      const result = await LaikaTask.runPromiseResult(provider.putSettings({ collections: {} }));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain('putSettings');
      }
    });

    it('putDocumentCollectionSettings returns failure', async () => {
      const provider = makeProvider({ collections: [] });
      const result = await LaikaTask.runPromiseResult(provider.putDocumentCollectionSettings('posts', {
        type: 'document',
        key: 'posts',
        name: 'Posts',
        directory: 'content/posts',
      }));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain('putDocumentCollectionSettings');
      }
    });

    it('putMediaCollectionSettings returns failure', async () => {
      const provider = makeProvider({ collections: [] });
      const result = await LaikaTask.runPromiseResult(provider.putMediaCollectionSettings('uploads', {
        type: 'media',
        key: 'uploads',
        name: 'Uploads',
        directory: 'content/uploads',
        recursive: false,
      }));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain('putMediaCollectionSettings');
      }
    });

    it('putCollectionSchema returns failure', async () => {
      const provider = makeProvider({ collections: [] });
      const result = await LaikaTask.runPromiseResult(provider.putCollectionSchema('posts', { type: 'object' }));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain('putCollectionSchema');
      }
    });
  });

  describe('getDocumentCollectionSettings', () => {
    it('returns document collection settings from config', async () => {
      const provider = makeProvider({
        collections: [
          {
            name: 'posts',
            label: 'Blog Posts',
            folder: 'content/posts',
            fields: [{ name: 'title', widget: 'string' }],
          },
        ],
      });

      const result = await LaikaTask.runPromiseResult(provider.getDocumentCollectionSettings('posts'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.type).toBe('document');
      expect(result.success.key).toBe('posts');
      expect(result.success.name).toBe('Blog Posts');
      expect(result.success.directory).toBe('content/posts');
    });

    it('returns default settings for an unknown collection', async () => {
      const provider = makeProvider({ collections: [] });
      const result = await LaikaTask.runPromiseResult(provider.getDocumentCollectionSettings('nope'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.type).toBe('document');
      expect(result.success.key).toBe('nope');
    });
  });

  describe('getMediaCollectionSettings', () => {
    it('returns default media settings when no public_folder in config', async () => {
      const provider = makeProvider({ collections: [] });
      const result = await LaikaTask.runPromiseResult(provider.getMediaCollectionSettings('uploads'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.type).toBe('media');
      expect(result.success.key).toBe('uploads');
    });

    it('injects public_folder url template when public_folder is set in config', async () => {
      const provider = makeProvider({ public_folder: '/uploads', collections: [] });
      const result = await LaikaTask.runPromiseResult(provider.getMediaCollectionSettings('uploads'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.url).toBe('/uploads/{filename}');
    });

    it('strips trailing slash from public_folder', async () => {
      const provider = makeProvider({ public_folder: '/uploads/', collections: [] });
      const result = await LaikaTask.runPromiseResult(provider.getMediaCollectionSettings('uploads'));
      expect(Result.isSuccess(result)).toBe(true);
      if (!Result.isSuccess(result)) return;

      expect(result.success.url).toBe('/uploads/{filename}');
    });
  });

  describe('error handling', () => {
    it('returns failure when config file is missing', async () => {
      const storage = makeMemoryStorage(); // empty — no config key
      const provider = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
      const result = await LaikaTask.runPromiseResult(provider.getSettings());
      expect(Result.isFailure(result)).toBe(true);
    });

    it('returns failure when config content is not an object', async () => {
      const now = new Date().toISOString();
      const storage = makeMemoryStorage(
        new Map([
          ['config', {
            type: 'object',
            key: 'config',
            content: null as unknown as Record<string, unknown>,
            createdAt: now,
            updatedAt: now,
          }],
        ]),
      );
      const provider = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
      const result = await LaikaTask.runPromiseResult(provider.getSettings());
      expect(Result.isFailure(result)).toBe(true);
    });
  });
});
