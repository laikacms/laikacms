import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type { LaikaError } from 'laikacms/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DrizzleDocumentsRepository } from './documents-repository.js';
import type { DocumentModel, DrizzleDocumentsRepositoryOptions, RevisionModel } from './documents-repository.js';

// ---- in-memory query builders + callbacks ----

type Condition = (row: DocumentModel) => boolean;
type RevisionCondition = (row: RevisionModel) => boolean;

function makeInMemoryOptions():
  & DrizzleDocumentsRepositoryOptions<
    Condition,
    Condition,
    Condition,
    Condition,
    Condition,
    Condition,
    Condition,
    RevisionCondition,
    RevisionCondition,
    RevisionCondition
  >
  & { __documents: DocumentModel[], __revisions: RevisionModel[] }
{
  const documents: DocumentModel[] = [];
  const revisions: RevisionModel[] = [];

  const qb = {
    keyEquals: (value: string) => (row: DocumentModel) => row.key === value,
    keyStartsWith: (prefix: string) => (row: DocumentModel) => row.key.startsWith(prefix),
    statusEquals: (value: string) => (row: DocumentModel) => row.status === value,
    statusNotEquals: (value: string) => (row: DocumentModel) => row.status !== value,
    statusIn: (values: string[]) => (row: DocumentModel) => values.includes(row.status ?? ''),
    depthLte: (value: number) => (row: DocumentModel) => row.depth <= value,
    and: (...conds: Condition[]) => (row: DocumentModel) => conds.every(c => c(row)),
  };

  const rqb = {
    keyEquals: (value: string) => (row: RevisionModel) => row.key === value,
    revisionEquals: (value: string) => (row: RevisionModel) => row.revision === value,
    and: (...conds: RevisionCondition[]) => (row: RevisionModel) => conds.every(c => c(row)),
  };

  return {
    documentQueryBuilders: qb,
    revisionQueryBuilders: rqb,
    callbacks: {
      documents: {
        async insert({ values }) {
          const row: DocumentModel = { ...values };
          documents.push(row);
          return [row];
        },
        async update({ where, values }) {
          const updated: DocumentModel[] = [];
          for (const row of documents) {
            if (where(row)) {
              Object.assign(row, values);
              updated.push(row);
            }
          }
          return updated;
        },
        async delete({ where }) {
          const deleted: DocumentModel[] = [];
          for (let i = documents.length - 1; i >= 0; i--) {
            if (where(documents[i])) {
              deleted.push(...documents.splice(i, 1));
            }
          }
          return deleted;
        },
        async select({ where, limit, offset = 0, excludeContent: _exclude }) {
          const filtered = documents.filter(where);
          const sliced = filtered.slice(offset, limit !== undefined ? offset + limit : undefined);
          return sliced;
        },
        async count({ where }) {
          return documents.filter(where).length;
        },
      },
      revisions: {
        async insert({ values }) {
          const row: RevisionModel = { ...values };
          revisions.push(row);
          return [row];
        },
        async update({ where, values }) {
          const updated: RevisionModel[] = [];
          for (const row of revisions) {
            if (where(row)) {
              Object.assign(row, values);
              updated.push(row);
            }
          }
          return updated;
        },
        async delete({ where }) {
          const deleted: RevisionModel[] = [];
          for (let i = revisions.length - 1; i >= 0; i--) {
            if (where(revisions[i])) {
              deleted.push(...revisions.splice(i, 1));
            }
          }
          return deleted;
        },
        async select({ where, limit, offset = 0 }) {
          const filtered = revisions.filter(where);
          return filtered.slice(offset, limit !== undefined ? offset + limit : undefined);
        },
        async count({ where }) {
          return revisions.filter(where).length;
        },
      },
    },
    __documents: documents,
    __revisions: revisions,
  };
}

async function resolveTask<T>(task: LaikaTask.LaikaTask<T>): Promise<Result.Result<T, LaikaError>> {
  return LaikaTask.runPromiseResult(task);
}

// ---- tests ----

describe('DrizzleDocumentsRepository', () => {
  let repo: DrizzleDocumentsRepository<
    (row: DocumentModel) => boolean,
    (row: DocumentModel) => boolean,
    (row: DocumentModel) => boolean,
    (row: DocumentModel) => boolean,
    (row: DocumentModel) => boolean,
    (row: DocumentModel) => boolean,
    (row: DocumentModel) => boolean,
    (row: RevisionModel) => boolean,
    (row: RevisionModel) => boolean,
    (row: RevisionModel) => boolean
  >;

  beforeEach(() => {
    repo = new DrizzleDocumentsRepository(makeInMemoryOptions());
  });

  describe('createDocument', () => {
    it('creates and returns a published document', async () => {
      const result = await resolveTask(
        repo.createDocument({
          key: 'hello',
          type: 'published',
          status: 'published',
          content: { title: 'Hello' },
          language: 'en',
        }),
      );
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.key).toBe('hello');
        expect(result.success.type).toBe('published');
        expect(result.success.status).toBe('published');
        expect(result.success.content).toEqual({ title: 'Hello' });
      }
    });
  });

  describe('getDocument', () => {
    it('retrieves a document that was created', async () => {
      await resolveTask(
        repo.createDocument({
          key: 'world',
          type: 'published',
          status: 'published',
          content: { body: 'hi' },
          language: 'fr',
        }),
      );

      const result = await resolveTask(repo.getDocument('world'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.key).toBe('world');
        expect(result.success.language).toBe('fr');
      }
    });

    it('returns NotFoundError for a missing document', async () => {
      const result = await resolveTask(repo.getDocument('ghost'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });

    it('returns "und" (not "unk") when the stored language is null — LCMS-381', async () => {
      // Simulate a legacy DB row with language: null (e.g. inserted before the column existed)
      const opts = makeInMemoryOptions();
      const r = new DrizzleDocumentsRepository(opts);
      const now = new Date().toISOString();
      opts.__documents.push({
        key: 'null-lang-doc',
        depth: 1,
        status: 'published',
        language: null,
        content: JSON.stringify({}),
        createdAt: now,
        updatedAt: now,
      });
      const result = await resolveTask(r.getDocument('null-lang-doc'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.language).toBe('und');
      }
    });
  });

  describe('updateDocument', () => {
    it('updates content and returns updated document', async () => {
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
        repo.updateDocument({
          key: 'editable',
          type: 'published',
          status: 'published',
          content: { v: 2 },
          language: 'en',
        }),
      );
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.content).toEqual({ v: 2 });
      }
    });
  });

  describe('deleteDocument', () => {
    it('deletes a document so it can no longer be retrieved', async () => {
      await resolveTask(
        repo.createDocument({ key: 'to-delete', type: 'published', status: 'published', content: {}, language: 'en' }),
      );
      const deleteResult = await resolveTask(repo.deleteDocument('to-delete'));
      expect(Result.isSuccess(deleteResult)).toBe(true);

      const getResult = await resolveTask(repo.getDocument('to-delete'));
      expect(Result.isFailure(getResult)).toBe(true);
    });
  });

  describe('createUnpublished / getUnpublished', () => {
    it('creates and retrieves an unpublished document', async () => {
      const createResult = await resolveTask(
        repo.createUnpublished({
          key: 'draft-1',
          type: 'unpublished',
          content: { text: 'draft' },
          language: 'en',
          status: 'draft',
        }),
      );
      expect(Result.isSuccess(createResult)).toBe(true);
      if (Result.isSuccess(createResult)) {
        expect(createResult.success.status).toBe('draft');
        expect(createResult.success.type).toBe('unpublished');
      }

      const getResult = await resolveTask(repo.getUnpublished('draft-1'));
      expect(Result.isSuccess(getResult)).toBe(true);
    });

    it('returns NotFoundError for missing unpublished document', async () => {
      const result = await resolveTask(repo.getUnpublished('no-draft'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('updateUnpublished', () => {
    it('updates content and status of an existing draft', async () => {
      await resolveTask(
        repo.createUnpublished({
          key: 'upd-draft',
          type: 'unpublished',
          content: { v: 1 },
          language: 'en',
          status: 'draft',
        }),
      );
      const result = await resolveTask(
        repo.updateUnpublished({
          key: 'upd-draft',
          type: 'unpublished',
          content: { v: 2 },
          language: 'en',
          status: 'pending_review',
        }),
      );
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.content).toEqual({ v: 2 });
        expect(result.success.status).toBe('pending_review');
      }
    });

    it('returns NotFoundError when the key does not exist', async () => {
      const result = await resolveTask(
        repo.updateUnpublished({
          key: 'no-such-draft',
          type: 'unpublished',
          content: { v: 1 },
          language: 'en',
          status: 'draft',
        }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('deleteUnpublished', () => {
    it('removes a draft so subsequent getUnpublished returns NotFoundError', async () => {
      await resolveTask(
        repo.createUnpublished({
          key: 'del-draft',
          type: 'unpublished',
          content: { x: 1 },
          language: 'en',
          status: 'draft',
        }),
      );
      const deleteResult = await resolveTask(repo.deleteUnpublished('del-draft'));
      expect(Result.isSuccess(deleteResult)).toBe(true);

      const getResult = await resolveTask(repo.getUnpublished('del-draft'));
      expect(Result.isFailure(getResult)).toBe(true);
      if (Result.isFailure(getResult)) {
        expect(getResult.failure.code).toBe(NotFoundError.CODE);
      }
    });

    it('succeeds silently when the key does not exist', async () => {
      const result = await resolveTask(repo.deleteUnpublished('ghost-draft'));
      expect(Result.isSuccess(result)).toBe(true);
    });
  });

  describe('publish workflow', () => {
    it('publishes an unpublished document', async () => {
      await resolveTask(
        repo.createUnpublished({
          key: 'workflow',
          type: 'unpublished',
          content: { state: 'draft' },
          language: 'en',
          status: 'draft',
        }),
      );
      const result = await resolveTask(repo.publish('workflow'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.type).toBe('published');
        expect(result.success.key).toBe('workflow');
      }
    });
  });

  describe('unpublish workflow', () => {
    it('unpublishes a published document', async () => {
      await resolveTask(
        repo.createDocument({
          key: 'live-doc',
          type: 'published',
          status: 'published',
          content: { x: 1 },
          language: 'en',
        }),
      );
      const result = await resolveTask(repo.unpublish('live-doc', 'draft'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.type).toBe('unpublished');
        expect(result.success.status).toBe('draft');
      }
    });
  });

  describe('listRecords', () => {
    it('lists published documents', async () => {
      await resolveTask(
        repo.createDocument({ key: 'r1', type: 'published', status: 'published', content: {}, language: 'en' }),
      );
      await resolveTask(
        repo.createDocument({ key: 'r2', type: 'published', status: 'published', content: {}, language: 'en' }),
      );

      const docs: import('laikacms/documents').Record[] = [];
      for await (
        const chunk of repo.listRecords({
          type: 'published',
          folder: '',
          pagination: { offset: 0, limit: 100 },
          depth: 10,
        })
      ) {
        for (const el of chunk) {
          if (el._tag === 'Data') docs.push(el.value);
        }
      }

      expect(docs.length).toBeGreaterThanOrEqual(2);
    });

    it('emits correct type, status, and language for published records', async () => {
      await resolveTask(
        repo.createDocument({ key: 'pub-a', type: 'published', status: 'published', content: {}, language: 'en' }),
      );

      const docs: import('laikacms/documents').Record[] = [];
      for await (
        const chunk of repo.listRecords({
          type: 'published',
          folder: '',
          pagination: { offset: 0, limit: 100 },
          depth: 10,
        })
      ) {
        for (const el of chunk) {
          if (el._tag === 'Data') docs.push(el.value);
        }
      }

      const doc = docs.find(d => d.key === 'pub-a');
      expect(doc).toBeDefined();
      expect(doc!.type).toBe('published');
      expect(doc!.status).toBe('published');
      expect((doc as import('laikacms/documents').Document).language).toBe('en');
    });

    it('emits correct type, status, and language for unpublished records', async () => {
      await resolveTask(
        repo.createUnpublished({ key: 'draft-x', type: 'unpublished', content: {}, language: 'fr', status: 'draft' }),
      );

      const docs: import('laikacms/documents').Record[] = [];
      for await (
        const chunk of repo.listRecords({
          type: 'unpublished',
          folder: '',
          pagination: { offset: 0, limit: 100 },
          depth: 10,
        })
      ) {
        for (const el of chunk) {
          if (el._tag === 'Data') docs.push(el.value);
        }
      }

      const doc = docs.find(d => d.key === 'draft-x');
      expect(doc).toBeDefined();
      expect(doc!.type).toBe('unpublished');
      expect(doc!.status).toBe('draft');
      expect((doc as import('laikacms/documents').Unpublished).language).toBe('fr');
    });

    it('depth:1 at root returns only 1-segment keys (LCMS-422)', async () => {
      const opts = makeInMemoryOptions();
      const r = new DrizzleDocumentsRepository(opts);
      const now = new Date().toISOString();
      // push rows directly to bypass createDocument (which would also compute depth correctly)
      opts.__documents.push({
        key: 'posts',
        depth: 1,
        status: 'published',
        language: 'en',
        content: '{}',
        createdAt: now,
        updatedAt: now,
      });
      opts.__documents.push({
        key: 'posts/hello',
        depth: 2,
        status: 'published',
        language: 'en',
        content: '{}',
        createdAt: now,
        updatedAt: now,
      });
      opts.__documents.push({
        key: 'posts/nested/file',
        depth: 3,
        status: 'published',
        language: 'en',
        content: '{}',
        createdAt: now,
        updatedAt: now,
      });

      const collected = await Effect.runPromise(
        LaikaStream.runCollect(
          r.listRecords({ type: 'published', folder: '', depth: 1, pagination: { offset: 0, limit: 100 } }),
        ),
      );

      expect(collected.data.map(d => d.key)).toEqual(['posts']);
    });

    it('depth:0 at root returns no documents (LCMS-422)', async () => {
      const opts = makeInMemoryOptions();
      const r = new DrizzleDocumentsRepository(opts);
      const now = new Date().toISOString();
      opts.__documents.push({
        key: 'posts',
        depth: 1,
        status: 'published',
        language: 'en',
        content: '{}',
        createdAt: now,
        updatedAt: now,
      });

      const collected = await Effect.runPromise(
        LaikaStream.runCollect(
          r.listRecords({ type: 'published', folder: '', depth: 0, pagination: { offset: 0, limit: 100 } }),
        ),
      );

      expect(collected.data).toHaveLength(0);
    });

    it('returns the correct page when using page-based pagination', async () => {
      const keys = ['p1', 'p2', 'p3', 'p4', 'p5'];
      for (const key of keys) {
        await resolveTask(
          repo.createDocument({ key, type: 'published', status: 'published', content: {}, language: 'en' }),
        );
      }

      const page2Docs: import('laikacms/documents').Record[] = [];
      for await (
        const chunk of repo.listRecords({
          type: 'published',
          folder: '',
          pagination: { page: 2, perPage: 2 },
          depth: 10,
        })
      ) {
        for (const el of chunk) {
          if (el._tag === 'Data') page2Docs.push(el.value);
        }
      }

      expect(page2Docs.length).toBe(2);
      expect(page2Docs.map(d => d.key)).toEqual(['p3', 'p4']);
    });
  });

  describe('listRecords done.total', () => {
    it('returns the full matching count in done.total, not just the page size', async () => {
      const keys = ['t1', 't2', 't3', 't4', 't5'];
      for (const key of keys) {
        await resolveTask(
          repo.createDocument({ key, type: 'published', status: 'published', content: {}, language: 'en' }),
        );
      }

      const collected = await Effect.runPromise(
        LaikaStream.runCollect(
          repo.listRecords({ type: 'published', folder: '', pagination: { limit: 2, offset: 0 }, depth: 10 }),
        ),
      );

      expect(collected.data.length).toBe(2);
      expect(collected.done.total).toBeGreaterThanOrEqual(5);
    });

    it('returns full count with page-based pagination', async () => {
      const keys = ['pg1', 'pg2', 'pg3', 'pg4', 'pg5'];
      for (const key of keys) {
        await resolveTask(
          repo.createDocument({ key, type: 'published', status: 'published', content: {}, language: 'en' }),
        );
      }

      const collected = await Effect.runPromise(
        LaikaStream.runCollect(
          repo.listRecords({ type: 'published', folder: '', pagination: { page: 1, perPage: 2 }, depth: 10 }),
        ),
      );

      expect(collected.data.length).toBe(2);
      expect(collected.done.total).toBeGreaterThanOrEqual(5);
    });
  });

  describe('listRecordSummaries done.total', () => {
    it('returns the full matching count in done.total, not just the page size', async () => {
      const keys = ['st1', 'st2', 'st3', 'st4', 'st5'];
      for (const key of keys) {
        await resolveTask(
          repo.createDocument({ key, type: 'published', status: 'published', content: {}, language: 'en' }),
        );
      }

      const collected = await Effect.runPromise(
        LaikaStream.runCollect(
          repo.listRecordSummaries({ type: 'published', folder: '', pagination: { limit: 2, offset: 0 }, depth: 10 }),
        ),
      );

      expect(collected.data.length).toBe(2);
      expect(collected.done.total).toBeGreaterThanOrEqual(5);
    });
  });

  describe('listRecordSummaries', () => {
    it('emits published-summary type, correct status and language for published records', async () => {
      await resolveTask(
        repo.createDocument({ key: 'sum-pub', type: 'published', status: 'published', content: {}, language: 'de' }),
      );

      const summaries: import('laikacms/documents').RecordSummary[] = [];
      for await (
        const chunk of repo.listRecordSummaries({
          type: 'published',
          folder: '',
          pagination: { offset: 0, limit: 100 },
          depth: 10,
        })
      ) {
        for (const el of chunk) {
          if (el._tag === 'Data') summaries.push(el.value);
        }
      }

      const summary = summaries.find(s => s.key === 'sum-pub');
      expect(summary).toBeDefined();
      expect(summary!.type).toBe('published-summary');
      expect(summary!.status).toBe('published');
      expect((summary as import('laikacms/documents').DocumentSummary).language).toBe('de');
    });

    it('emits unpublished-summary type, correct status and language for unpublished records', async () => {
      await resolveTask(
        repo.createUnpublished({
          key: 'sum-draft',
          type: 'unpublished',
          content: {},
          language: 'nl',
          status: 'pending_review',
        }),
      );

      const summaries: import('laikacms/documents').RecordSummary[] = [];
      for await (
        const chunk of repo.listRecordSummaries({
          type: 'unpublished',
          folder: '',
          pagination: { offset: 0, limit: 100 },
          depth: 10,
        })
      ) {
        for (const el of chunk) {
          if (el._tag === 'Data') summaries.push(el.value);
        }
      }

      const summary = summaries.find(s => s.key === 'sum-draft');
      expect(summary).toBeDefined();
      expect(summary!.type).toBe('unpublished-summary');
      expect(summary!.status).toBe('pending_review');
      expect((summary as import('laikacms/documents').UnpublishedSummary).language).toBe('nl');
    });
  });

  describe('createRevision / getRevision / listRevisions', () => {
    it('creates and retrieves a revision', async () => {
      const createResult = await resolveTask(
        repo.createRevision({
          key: 'doc',
          type: 'revision',
          revision: 'v1',
          content: { original: true },
          language: 'en',
        }),
      );
      expect(Result.isSuccess(createResult)).toBe(true);

      const getResult = await resolveTask(repo.getRevision('doc', 'v1'));
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.revision).toBe('v1');
        expect(getResult.success.content).toEqual({ original: true });
      }
    });

    it('returns NotFoundError for a missing revision', async () => {
      const result = await resolveTask(repo.getRevision('doc', 'vXXX'));
      expect(Result.isFailure(result)).toBe(true);
    });

    it('lists revisions for a key', async () => {
      await resolveTask(
        repo.createRevision({ key: 'doc', type: 'revision', revision: 'v1', content: {}, language: 'en' }),
      );
      await resolveTask(
        repo.createRevision({ key: 'doc', type: 'revision', revision: 'v2', content: {}, language: 'en' }),
      );

      const summaries: import('laikacms/documents').RevisionSummary[] = [];
      for await (const chunk of repo.listRevisions('doc', { pagination: { offset: 0, limit: 100 } })) {
        for (const el of chunk) {
          if (el._tag === 'Data') summaries.push(el.value);
        }
      }

      expect(summaries.length).toBe(2);
      expect(summaries.map(s => s.revision)).toContain('v1');
      expect(summaries.map(s => s.revision)).toContain('v2');
    });

    it('done.total — returns full count, not page count', async () => {
      const revisionIds = ['r1', 'r2', 'r3', 'r4', 'r5'];
      for (const revision of revisionIds) {
        await resolveTask(
          repo.createRevision({ key: 'rev-doc', type: 'revision', revision, content: {}, language: 'en' }),
        );
      }

      const collected = await Effect.runPromise(
        LaikaStream.runCollect(
          repo.listRevisions('rev-doc', { pagination: { limit: 2, offset: 0 } }),
        ),
      );

      expect(collected.data.length).toBe(2);
      expect(collected.done.total).toBe(5);
    });
  });
});

describe('DrizzleDocumentsRepository — getCapabilities', () => {
  it('returns a compatibilityDate string and a pagination object', async () => {
    const repo = new DrizzleDocumentsRepository(makeInMemoryOptions());
    const caps = await LaikaTask.runPromise(repo.getCapabilities());
    expect(typeof caps.compatibilityDate).toBe('string');
    expect(caps.compatibilityDate.length).toBeGreaterThan(0);
    expect(caps.pagination).toBeDefined();
    expect(caps.pagination.supported).toBe(true);
  });
});
