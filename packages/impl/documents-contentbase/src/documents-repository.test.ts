import type { ContentBaseSettingsProvider } from '@laikacms/contentbase-settings';
import type { DocumentCollectionSettings } from '@laikacms/contentbase-settings';
import type { LaikaResult } from '@laikacms/core';
import { NotFoundError } from '@laikacms/core';
import type { StorageRepository } from '@laikacms/storage';
import type {
  Atom,
  AtomSummary,
  FolderCreate,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
} from '@laikacms/storage';
import * as Result from 'effect/Result';
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

    async *listAtoms(folderKey: string, _options: unknown) {
      const prefix = folderKey.endsWith('/') ? folderKey : folderKey + '/';
      const atoms: Atom[] = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix) || k === folderKey) atoms.push(v as Atom);
      }
      yield Result.succeed(atoms as readonly Atom[]);
    },

    async *listAtomSummaries(folderKey: string, _options: unknown) {
      const prefix = folderKey.endsWith('/') ? folderKey : folderKey + '/';
      const atoms: AtomSummary[] = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix) || k === folderKey) {
          atoms.push({ ...v, type: 'object-summary' } as AtomSummary);
        }
      }
      yield Result.succeed(atoms as readonly AtomSummary[]);
    },

    async *getFolder(_key: string) {
      yield Result.fail(new NotFoundError('getFolder not implemented in mock'));
    },

    async *createFolder(_create: FolderCreate) {
      yield Result.fail(new NotFoundError('createFolder not implemented in mock'));
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
    async *getDocumentCollectionSettings(_collection: string) {
      yield Result.succeed(defaults);
    },
    async *getSettings() {
      yield Result.succeed({ collections: {} });
    },
    async *putSettings() {
      yield Result.succeed(undefined);
    },
    async *putDocumentCollectionSettings() {
      yield Result.succeed(undefined);
    },
    async *getMediaCollectionSettings() {
      yield Result.fail(new NotFoundError('not found'));
    },
    async *putMediaCollectionSettings() {
      yield Result.succeed(undefined);
    },
    async *getCollectionSchema() {
      yield Result.fail(new NotFoundError('no schema'));
    },
    async *putCollectionSchema() {
      yield Result.succeed(undefined);
    },
  } as ContentBaseSettingsProvider;
}

async function firstResult<T>(gen: AsyncGenerator<LaikaResult<T>>): Promise<LaikaResult<T>> {
  for await (const result of gen) return result;
  return Result.fail(new NotFoundError('No result'));
}

// ---- tests ----

describe('ContentBaseDocumentsRepository', () => {
  let storage: StorageRepository;
  let settings: ContentBaseSettingsProvider;
  let repo: ContentBaseDocumentsRepository;

  beforeEach(() => {
    storage = makeMemoryStorage();
    settings = makeSettingsProvider();
    repo = new ContentBaseDocumentsRepository('posts', storage, settings);
  });

  describe('createDocument', () => {
    it('creates a published document and returns it', async () => {
      const result = await firstResult(
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
      await firstResult(
        repo.createDocument({
          key: 'my-doc',
          type: 'published',
          status: 'published',
          content: { body: 'test' },
          language: 'en',
        }),
      );

      const result = await firstResult(repo.getDocument('my-doc'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.key).toBe('my-doc');
        expect(result.success.type).toBe('published');
        expect(result.success.content).toEqual({ body: 'test' });
      }
    });

    it('returns NotFoundError for a non-existent document', async () => {
      const result = await firstResult(repo.getDocument('does-not-exist'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('updateDocument', () => {
    it('updates content of an existing document', async () => {
      await firstResult(
        repo.createDocument({
          key: 'editable',
          type: 'published',
          status: 'published',
          content: { v: 1 },
          language: 'en',
        }),
      );

      const result = await firstResult(
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
      await firstResult(
        repo.createDocument({ key: 'to-delete', type: 'published', status: 'published', content: {}, language: 'en' }),
      );
      const deleteResult = await firstResult(repo.deleteDocument('to-delete'));
      expect(Result.isSuccess(deleteResult)).toBe(true);

      const getResult = await firstResult(repo.getDocument('to-delete'));
      expect(Result.isFailure(getResult)).toBe(true);
    });
  });

  describe('listRecords', () => {
    it('lists documents in the collection', async () => {
      await firstResult(
        repo.createDocument({
          key: 'doc-a',
          type: 'published',
          status: 'published',
          content: { x: 1 },
          language: 'en',
        }),
      );
      await firstResult(
        repo.createDocument({
          key: 'doc-b',
          type: 'published',
          status: 'published',
          content: { x: 2 },
          language: 'en',
        }),
      );

      const results: LaikaResult<readonly import('@laikacms/documents').Record[]>[] = [];
      for await (const r of repo.listRecords({ folder: '', pagination: { offset: 0, limit: 100 }, depth: 1 })) {
        results.push(r);
      }

      const allDocs = results
        .filter(r => Result.isSuccess(r))
        .flatMap(r => (Result.isSuccess(r) ? [...r.success] : []));

      expect(allDocs.length).toBeGreaterThanOrEqual(2);
      const keys = allDocs.map(d => d.key);
      expect(keys).toContain('doc-a');
      expect(keys).toContain('doc-b');
    });
  });

  describe('createUnpublished / getUnpublished', () => {
    it('creates and retrieves an unpublished document', async () => {
      const createResult = await firstResult(
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

      const getResult = await firstResult(repo.getUnpublished('draft-post'));
      expect(Result.isSuccess(getResult)).toBe(true);
    });

    it('returns NotFoundError for non-existent unpublished document', async () => {
      const result = await firstResult(repo.getUnpublished('no-such-draft'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('publish workflow', () => {
    it('publishes an unpublished document', async () => {
      await firstResult(
        repo.createUnpublished({
          key: 'workflow-doc',
          type: 'unpublished',
          content: { state: 'draft' },
          language: 'en',
          status: 'draft',
        }),
      );

      const publishResult = await firstResult(repo.publish('workflow-doc'));
      expect(Result.isSuccess(publishResult)).toBe(true);
      if (Result.isSuccess(publishResult)) {
        expect(publishResult.success.type).toBe('published');
        expect(publishResult.success.key).toBe('workflow-doc');
      }
    });
  });

  describe('createRevision / getRevision', () => {
    it('creates and retrieves a revision', async () => {
      const createResult = await firstResult(
        repo.createRevision({
          key: 'my-doc',
          type: 'revision',
          revision: 'v1',
          content: { text: 'original' },
          language: 'en',
        }),
      );
      expect(Result.isSuccess(createResult)).toBe(true);

      const getResult = await firstResult(repo.getRevision('my-doc', 'v1'));
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.revision).toBe('v1');
        expect(getResult.success.content).toEqual({ text: 'original' });
      }
    });
  });
});
