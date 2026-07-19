import * as Result from 'effect/Result';
import type { ContentBaseSettingsProvider } from 'laikacms/contentbase-settings';
import type { DocumentCollectionSettings } from 'laikacms/contentbase-settings';
import { BadRequestError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
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

    listAtoms(folderKey: string, _options: unknown): LaikaStream.LaikaStream<Atom, { total: number }> {
      const prefix = folderKey.endsWith('/') ? folderKey : folderKey + '/';
      const atoms: Atom[] = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix) || k === folderKey) atoms.push(v as Atom);
      }
      return atoms.length > 0
        ? LaikaStream.succeedMany(atoms as Atom[], { total: atoms.length })
        : LaikaStream.empty({ total: 0 });
    },

    listAtomSummaries(folderKey: string, _options: unknown): LaikaStream.LaikaStream<AtomSummary, { total: number }> {
      const prefix = folderKey.endsWith('/') ? folderKey : folderKey + '/';
      const atoms: AtomSummary[] = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix) || k === folderKey) {
          atoms.push({ ...v, type: 'object-summary' } as AtomSummary);
        }
      }
      return atoms.length > 0
        ? LaikaStream.succeedMany(atoms, { total: atoms.length })
        : LaikaStream.empty({ total: 0 });
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
        compatibilityDate: '2026-05-11',
        pagination: {
          supported: true,
          description: 'In-memory mock storage.',
          styles: { offset: true, page: true, cursor: false },
        },
      });
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
    getDocumentCollectionSettings(_collection: string) {
      return LaikaTask.succeed(defaults);
    },
    getSettings() {
      return LaikaTask.succeed({ collections: {} });
    },
    putSettings() {
      return LaikaTask.succeed(undefined);
    },
    putDocumentCollectionSettings() {
      return LaikaTask.succeed(undefined);
    },
    getMediaCollectionSettings() {
      return LaikaTask.fail(new NotFoundError('not found'));
    },
    putMediaCollectionSettings() {
      return LaikaTask.succeed(undefined);
    },
    getCollectionSchema() {
      return LaikaTask.fail(new NotFoundError('no schema'));
    },
    putCollectionSchema() {
      return LaikaTask.succeed(undefined);
    },
  } as ContentBaseSettingsProvider;
}

async function resolveTask<T>(task: LaikaTask.LaikaTask<T>): Promise<Result.Result<T, LaikaError>> {
  return LaikaTask.runPromiseResult(task);
}

async function collectStream<A, D extends object>(
  stream: LaikaStream.LaikaStream<A, D>,
): Promise<{ data: A[], done: D }> {
  return LaikaStream.runPromiseCollect(stream).then(r => ({ data: [...r.data], done: r.done }));
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
        // language is embedded in content so create↔read agree (LCMS-222)
        expect(result.success.content).toEqual({ title: 'Hello World', language: 'en' });
      }
    });

    it('language persists through create→get roundtrip (LCMS-222 regression)', async () => {
      await resolveTask(
        repo.createDocument({
          key: 'posts/lang-test',
          type: 'published',
          status: 'published',
          content: { title: 'Lang Test' },
          language: 'nl',
        }),
      );

      const getResult = await resolveTask(repo.getDocument('posts/lang-test'));
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.language).toBe('nl');
        expect(getResult.success.content.language).toBe('nl');
      }
    });

    // LCMS-448: spreading a string content into { ...str, language } produces character-indexed keys.
    // The guard rejects non-object content before the spread so the failure is loud, not silent.
    it('rejects string content with BadRequestError (LCMS-448 guard)', async () => {
      const result = await resolveTask(
        repo.createDocument({
          key: 'posts/corrupt',
          type: 'published',
          status: 'published',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: '---\ntitle: T\n---\nB\n' as any,
          language: 'en',
        }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(BadRequestError.CODE);
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
        expect(result.success.language).toBe('en');
        expect(result.success.content).toMatchObject({ body: 'test' });
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
        // language is preserved from the original document (LCMS-222)
        expect(result.success.content).toMatchObject({ v: 2 });
        expect(result.success.language).toBe('en');
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

    it('done.total reflects pre-pagination full count, not page count (LCMS-219)', async () => {
      for (const key of ['posts/a', 'posts/b', 'posts/c', 'posts/d', 'posts/e']) {
        await resolveTask(
          repo.createDocument({ key, type: 'published', status: 'published', content: {}, language: 'en' }),
        );
      }

      const { data, done } = await collectStream(
        repo.listRecords({ folder: 'posts', pagination: { offset: 0, limit: 2 }, depth: 1 }),
      );
      // Only 2 items on the page, but total should be 5
      expect(data.length).toBeLessThanOrEqual(5);
      expect(done.total).toBe(5);
    });

    it('returns BadRequestError when folder is empty (LCMS-268)', async () => {
      const result = await LaikaStream.runPromiseResult(
        repo.listRecords({ folder: '', pagination: { offset: 0, limit: 100 }, depth: 1 }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(BadRequestError.CODE);
      }
    });
  });

  describe('listRecordSummaries', () => {
    it('done.total reflects pre-pagination full count, not page count (LCMS-219)', async () => {
      for (const key of ['posts/s1', 'posts/s2', 'posts/s3']) {
        await resolveTask(
          repo.createDocument({ key, type: 'published', status: 'published', content: {}, language: 'en' }),
        );
      }

      const { done } = await collectStream(
        repo.listRecordSummaries({ folder: 'posts', pagination: { offset: 0, limit: 2 }, depth: 1 }),
      );
      expect(done.total).toBe(3);
    });

    it('returns BadRequestError when folder is empty (LCMS-268)', async () => {
      const result = await LaikaStream.runPromiseResult(
        repo.listRecordSummaries({ folder: '', pagination: { offset: 0, limit: 100 }, depth: 1 }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(BadRequestError.CODE);
      }
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

  describe('updateUnpublished', () => {
    it('updates content of an existing unpublished document', async () => {
      await resolveTask(
        repo.createUnpublished({
          key: 'posts/draft-update',
          type: 'unpublished',
          content: { title: 'Original' },
          language: 'en',
          status: 'draft',
        }),
      );

      const result = await resolveTask(
        repo.updateUnpublished({ key: 'posts/draft-update', content: { title: 'Updated' } }),
      );
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.key).toBe('posts/draft-update');
        expect(result.success.type).toBe('unpublished');
        expect(result.success.content).toMatchObject({ title: 'Updated' });
        expect(result.success.language).toBe('en');
        expect(result.success.status).toBe('draft');
      }
    });

    it('updates language of an existing unpublished document', async () => {
      await resolveTask(
        repo.createUnpublished({
          key: 'posts/draft-lang',
          type: 'unpublished',
          content: { title: 'Bonjour' },
          language: 'en',
          status: 'draft',
        }),
      );

      const result = await resolveTask(
        repo.updateUnpublished({ key: 'posts/draft-lang', language: 'fr' }),
      );
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.language).toBe('fr');
      }
    });

    it('applies content + language edits when changing status in the same call', async () => {
      // Use a repo that has both draft and pending_review statuses configured.
      const multiStatusStorage = makeMemoryStorage();
      const multiStatusRepo = new ContentBaseDocumentsRepository(
        multiStatusStorage,
        makeSettingsProvider({
          unpublishedStatuses: {
            draft: { directory: 'draft', name: 'Draft' },
            pending_review: { directory: 'pending-review', name: 'Pending Review' },
          },
        }),
      );

      await resolveTask(
        multiStatusRepo.createUnpublished({
          key: 'posts/draft-status-content',
          type: 'unpublished',
          content: { title: 'Original', body: 'old' },
          language: 'en',
          status: 'draft',
        }),
      );

      const result = await resolveTask(
        multiStatusRepo.updateUnpublished({
          key: 'posts/draft-status-content',
          status: 'pending_review',
          content: { title: 'Edited', body: 'new' },
          language: 'fr',
        }),
      );
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.status).toBe('pending_review');
        expect(result.success.language).toBe('fr');
        expect(result.success.content).toMatchObject({ title: 'Edited', body: 'new' });
      }

      // Confirm the edit persisted after the status move
      const readback = await resolveTask(multiStatusRepo.getUnpublished('posts/draft-status-content'));
      expect(Result.isSuccess(readback)).toBe(true);
      if (Result.isSuccess(readback)) {
        expect(readback.success.status).toBe('pending_review');
        expect(readback.success.language).toBe('fr');
        expect(readback.success.content).toMatchObject({ title: 'Edited', body: 'new' });
      }
    });

    it('returns NotFoundError when updating a non-existent unpublished document', async () => {
      const result = await resolveTask(
        repo.updateUnpublished({ key: 'posts/no-such-draft', content: { x: 1 } }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('deleteUnpublished', () => {
    it('removes an existing draft document', async () => {
      await resolveTask(
        repo.createUnpublished({
          key: 'posts/to-delete-draft',
          type: 'unpublished',
          content: { title: 'Bye' },
          language: 'en',
          status: 'draft',
        }),
      );

      const deleteResult = await resolveTask(repo.deleteUnpublished('posts/to-delete-draft'));
      expect(Result.isSuccess(deleteResult)).toBe(true);

      // Confirm the document is gone
      const getResult = await resolveTask(repo.getUnpublished('posts/to-delete-draft'));
      expect(Result.isFailure(getResult)).toBe(true);
      if (Result.isFailure(getResult)) {
        expect(getResult.failure.code).toBe(NotFoundError.CODE);
      }
    });

    it('returns NotFoundError when deleting a non-existent unpublished document', async () => {
      const result = await resolveTask(repo.deleteUnpublished('posts/ghost-draft'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('unpublish workflow', () => {
    it('moves a published document to unpublished with a known status', async () => {
      await resolveTask(
        repo.createDocument({
          key: 'posts/published-to-draft',
          type: 'published',
          status: 'published',
          content: { title: 'Published' },
          language: 'en',
        }),
      );

      const unpublishResult = await resolveTask(repo.unpublish('posts/published-to-draft', 'draft'));
      expect(Result.isSuccess(unpublishResult)).toBe(true);
      if (Result.isSuccess(unpublishResult)) {
        expect(unpublishResult.success.type).toBe('unpublished');
        expect(unpublishResult.success.status).toBe('draft');
        expect(unpublishResult.success.key).toBe('posts/published-to-draft');
        expect(unpublishResult.success.content).toMatchObject({ title: 'Published' });
      }

      // The original published document should be gone
      const getPublishedResult = await resolveTask(repo.getDocument('posts/published-to-draft'));
      expect(Result.isFailure(getPublishedResult)).toBe(true);
    });

    it('returns BadRequestError for an unknown unpublished status', async () => {
      await resolveTask(
        repo.createDocument({
          key: 'posts/another-doc',
          type: 'published',
          status: 'published',
          content: { title: 'To Unpublish' },
          language: 'en',
        }),
      );

      const result = await resolveTask(repo.unpublish('posts/another-doc', 'nonexistent-status'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(BadRequestError.CODE);
      }
    });

    it('returns NotFoundError when trying to unpublish a non-existent document', async () => {
      const result = await resolveTask(repo.unpublish('posts/no-such-doc', 'draft'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('createRevision / getRevision / listRevisions', () => {
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
        expect(getResult.success.language).toBe('en');
        expect(getResult.success.content).toMatchObject({ text: 'original' });
      }
    });

    it('listRevisions done.total reflects pre-pagination full count (LCMS-219)', async () => {
      for (const rev of ['r1', 'r2', 'r3', 'r4']) {
        await resolveTask(
          repo.createRevision({ key: 'rev-doc', type: 'revision', revision: rev, content: {}, language: 'en' }),
        );
      }

      const { done } = await collectStream(
        repo.listRevisions('rev-doc', { pagination: { offset: 0, limit: 2 } }),
      );
      expect(done.total).toBe(4);
    });
  });
});

describe('ContentBaseDocumentsRepository — getCapabilities', () => {
  it('returns a compatibilityDate string and forwards pagination from the underlying storage mock', async () => {
    const storage = makeMemoryStorage();
    const repo = new ContentBaseDocumentsRepository(storage, makeSettingsProvider());
    const caps = await LaikaTask.runPromise(repo.getCapabilities());
    expect(typeof caps.compatibilityDate).toBe('string');
    expect(caps.compatibilityDate.length).toBeGreaterThan(0);
    // Pagination is forwarded from the underlying storage mock
    expect(caps.pagination).toBeDefined();
    expect(caps.pagination.supported).toBe(true);
    expect(caps.pagination.styles).toBeDefined();
  });
});
