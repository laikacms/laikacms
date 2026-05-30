import * as Result from 'effect/Result';
import type { ContentBaseSettingsProvider } from 'laikacms/contentbase-settings';
import type { DocumentCollectionSettings } from 'laikacms/contentbase-settings';
import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type { LaikaError } from 'laikacms/core';
import type { StorageRepository } from 'laikacms/storage';
import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
} from 'laikacms/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { ContentBaseDocumentsRepository } from './documents-repository.js';

// ---- helpers ----

function makeStorageObject(key: string, content: Record<string, unknown>): StorageObject {
  const now = new Date().toISOString();
  return { type: 'object', key, content, createdAt: now, updatedAt: now };
}

function makeMemoryStorage(): StorageRepository {
  const store = new Map<string, StorageObject>();

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

    listAtoms(folderKey: string, _options: unknown): LaikaStream.LaikaStream<Atom, object> {
      const prefix = folderKey.endsWith('/') ? folderKey : folderKey + '/';
      const atoms: Atom[] = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix) || k === folderKey) atoms.push(v as Atom);
      }
      return atoms.length > 0 ? LaikaStream.succeedMany(atoms as Atom[], {}) : LaikaStream.empty({});
    },

    listAtomSummaries(folderKey: string, _options: unknown): LaikaStream.LaikaStream<AtomSummary, object> {
      const prefix = folderKey.endsWith('/') ? folderKey : folderKey + '/';
      const atoms: AtomSummary[] = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix) || k === folderKey) {
          atoms.push({ ...v, type: 'object-summary' } as AtomSummary);
        }
      }
      return atoms.length > 0 ? LaikaStream.succeedMany(atoms, {}) : LaikaStream.empty({});
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
      return LaikaTask.succeed({});
    },
  } as unknown as StorageRepository;
}

function makeSettingsProvider(overrides?: Partial<DocumentCollectionSettings>): ContentBaseSettingsProvider {
  const defaults: DocumentCollectionSettings = {
    type: 'document',
    key: 'posts',
    name: 'Posts',
    directory: 'posts',
    unpublishedStatuses: {
      draft: { directory: 'draft', name: 'Draft' },
    },
    revisionDirectory: '.contentbase/posts/revisions',
    ...overrides,
  };

  return {
    async getDocumentCollectionSettings(_collection: string) {
      return Result.succeed(defaults);
    },
    async getSettings() {
      return Result.succeed({ collections: {} });
    },
    async putSettings() {
      return Result.succeed(undefined);
    },
    async putDocumentCollectionSettings() {
      return Result.succeed(undefined);
    },
    async getMediaCollectionSettings() {
      return Result.fail(new NotFoundError('not found'));
    },
    async putMediaCollectionSettings() {
      return Result.succeed(undefined);
    },
    async getCollectionSchema() {
      return Result.fail(new NotFoundError('no schema'));
    },
    async putCollectionSchema() {
      return Result.succeed(undefined);
    },
  } as ContentBaseSettingsProvider;
}

async function resolveTask<T>(task: LaikaTask.LaikaTask<T>): Promise<Result.Result<T, LaikaError>> {
  return LaikaTask.runPromiseResult(task);
}

// ---- tests ----

describe('ContentBaseDocumentsRepository', () => {
  let storage: StorageRepository;
  let settings: ContentBaseSettingsProvider;
  let repo: ContentBaseDocumentsRepository;

  beforeEach(() => {
    storage = makeMemoryStorage();
    settings = makeSettingsProvider();
    repo = new ContentBaseDocumentsRepository(storage, settings);
  });

  describe('createDocument', () => {
    it('creates a published document and returns it', async () => {
      const result = await resolveTask(
        repo.createDocument({
          key: 'hello-world',
          type: 'published',
          status: 'published',
          content: { title: 'Hello World' },
          language: 'en',
        }),
      );
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.key).toBe('hello-world');
        expect(result.success.type).toBe('published');
        expect(result.success.status).toBe('published');
        expect(result.success.language).toBe('en');
        expect(result.success.content).toEqual({ title: 'Hello World' });
      }
    });
  });

  describe('getDocument', () => {
    it('retrieves a document that was previously created', async () => {
      await resolveTask(
        repo.createDocument({
          key: 'my-doc',
          type: 'published',
          status: 'published',
          content: { body: 'test' },
          language: 'en',
        }),
      );

      const result = await resolveTask(repo.getDocument('my-doc'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.key).toBe('my-doc');
        expect(result.success.type).toBe('published');
        expect(result.success.content).toEqual({ body: 'test' });
      }
    });

    it('returns NotFoundError for a non-existent document', async () => {
      const result = await resolveTask(repo.getDocument('does-not-exist'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('updateDocument', () => {
    it('updates content of an existing document', async () => {
      await resolveTask(
        repo.createDocument({
          key: 'editable',
          type: 'published',
          status: 'published',
          content: { v: 1 },
          language: 'en',
        }),
      );

      const result = await resolveTask(
        repo.updateDocument({ key: 'editable', content: { v: 2 } }),
      );
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.content).toEqual({ v: 2 });
      }
    });
  });

  describe('deleteDocument', () => {
    it('deletes an existing document', async () => {
      await resolveTask(
        repo.createDocument({ key: 'to-delete', type: 'published', status: 'published', content: {}, language: 'en' }),
      );
      const deleteResult = await resolveTask(repo.deleteDocument('to-delete'));
      expect(Result.isSuccess(deleteResult)).toBe(true);

      const getResult = await resolveTask(repo.getDocument('to-delete'));
      expect(Result.isFailure(getResult)).toBe(true);
    });
  });

  describe('listRecords', () => {
    it('lists documents in the collection', async () => {
      await resolveTask(
        repo.createDocument({
          key: 'posts/doc-a',
          type: 'published',
          status: 'published',
          content: { x: 1 },
          language: 'en',
        }),
      );
      await resolveTask(
        repo.createDocument({
          key: 'posts/doc-b',
          type: 'published',
          status: 'published',
          content: { x: 2 },
          language: 'en',
        }),
      );

      const allDocs: import('laikacms/documents').Record[] = [];
      for await (
        const chunk of repo.listRecords({ folder: 'posts', pagination: { offset: 0, limit: 100 }, depth: 1 })
      ) {
        for (const el of chunk) {
          if (el._tag === 'Data') allDocs.push(el.value);
        }
      }

      expect(allDocs.length).toBeGreaterThanOrEqual(2);
      const keys = allDocs.map(d => d.key);
      expect(keys).toContain('posts/doc-a');
      expect(keys).toContain('posts/doc-b');
    });
  });

  describe('createUnpublished / getUnpublished', () => {
    it('creates and retrieves an unpublished document', async () => {
      const createResult = await resolveTask(
        repo.createUnpublished({
          key: 'draft-post',
          type: 'unpublished',
          content: { title: 'Draft' },
          language: 'en',
          status: 'draft',
        }),
      );
      expect(Result.isSuccess(createResult)).toBe(true);
      if (Result.isSuccess(createResult)) {
        expect(createResult.success.status).toBe('draft');
        expect(createResult.success.type).toBe('unpublished');
      }

      const getResult = await resolveTask(repo.getUnpublished('draft-post'));
      expect(Result.isSuccess(getResult)).toBe(true);
    });

    it('returns NotFoundError for non-existent unpublished document', async () => {
      const result = await resolveTask(repo.getUnpublished('no-such-draft'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('publish workflow', () => {
    it('publishes an unpublished document', async () => {
      await resolveTask(
        repo.createUnpublished({
          key: 'workflow-doc',
          type: 'unpublished',
          content: { state: 'draft' },
          language: 'en',
          status: 'draft',
        }),
      );

      const publishResult = await resolveTask(repo.publish('workflow-doc'));
      expect(Result.isSuccess(publishResult)).toBe(true);
      if (Result.isSuccess(publishResult)) {
        expect(publishResult.success.type).toBe('published');
        expect(publishResult.success.key).toBe('workflow-doc');
      }
    });
  });

  describe('createRevision / getRevision', () => {
    it('creates and retrieves a revision', async () => {
      const createResult = await resolveTask(
        repo.createRevision({
          key: 'my-doc',
          type: 'revision',
          revision: 'v1',
          content: { text: 'original' },
          language: 'en',
        }),
      );
      expect(Result.isSuccess(createResult)).toBe(true);

      const getResult = await resolveTask(repo.getRevision('my-doc', 'v1'));
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.revision).toBe('v1');
        expect(getResult.success.content).toEqual({ text: 'original' });
      }
    });
  });
});
