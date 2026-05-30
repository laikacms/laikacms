import * as Result from 'effect/Result';
import { NotFoundError } from 'laikacms/core';
import type { LaikaResult } from 'laikacms/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DrizzleDocumentsRepository } from './documents-repository.js';
import type { DocumentModel, DrizzleDocumentsRepositoryOptions, RevisionModel } from './documents-repository.js';

// ---- in-memory query builders + callbacks ----

type Condition = (row: DocumentModel) => boolean;
type RevisionCondition = (row: RevisionModel) => boolean;

function makeInMemoryOptions(): DrizzleDocumentsRepositoryOptions<
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
> {
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
        async select({ where, limit }) {
          const filtered = revisions.filter(where);
          return limit !== undefined ? filtered.slice(0, limit) : filtered;
        },
      },
    },
  };
}

async function firstResult<T>(gen: AsyncGenerator<LaikaResult<T>>): Promise<LaikaResult<T>> {
  for await (const result of gen) return result;
  return Result.fail(new NotFoundError('No result from generator'));
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
      const result = await firstResult(
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
      await firstResult(
        repo.createDocument({
          key: 'world',
          type: 'published',
          status: 'published',
          content: { body: 'hi' },
          language: 'fr',
        }),
      );

      const result = await firstResult(repo.getDocument('world'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.key).toBe('world');
        expect(result.success.language).toBe('fr');
      }
    });

    it('returns NotFoundError for a missing document', async () => {
      const result = await firstResult(repo.getDocument('ghost'));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(NotFoundError.CODE);
      }
    });
  });

  describe('updateDocument', () => {
    it('updates content and returns updated document', async () => {
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
      await firstResult(
        repo.createDocument({ key: 'to-delete', type: 'published', status: 'published', content: {}, language: 'en' }),
      );
      const deleteResult = await firstResult(repo.deleteDocument('to-delete'));
      expect(Result.isSuccess(deleteResult)).toBe(true);

      const getResult = await firstResult(repo.getDocument('to-delete'));
      expect(Result.isFailure(getResult)).toBe(true);
    });
  });

  describe('createUnpublished / getUnpublished', () => {
    it('creates and retrieves an unpublished document', async () => {
      const createResult = await firstResult(
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

      const getResult = await firstResult(repo.getUnpublished('draft-1'));
      expect(Result.isSuccess(getResult)).toBe(true);
    });

    it('returns NotFoundError for missing unpublished document', async () => {
      const result = await firstResult(repo.getUnpublished('no-draft'));
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
          key: 'workflow',
          type: 'unpublished',
          content: { state: 'draft' },
          language: 'en',
          status: 'draft',
        }),
      );
      const result = await firstResult(repo.publish('workflow'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.type).toBe('published');
        expect(result.success.key).toBe('workflow');
      }
    });
  });

  describe('unpublish workflow', () => {
    it('unpublishes a published document', async () => {
      await firstResult(
        repo.createDocument({
          key: 'live-doc',
          type: 'published',
          status: 'published',
          content: { x: 1 },
          language: 'en',
        }),
      );
      const result = await firstResult(repo.unpublish('live-doc', 'draft'));
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.type).toBe('unpublished');
        expect(result.success.status).toBe('draft');
      }
    });
  });

  describe('listRecords', () => {
    it('lists published documents', async () => {
      await firstResult(
        repo.createDocument({ key: 'r1', type: 'published', status: 'published', content: {}, language: 'en' }),
      );
      await firstResult(
        repo.createDocument({ key: 'r2', type: 'published', status: 'published', content: {}, language: 'en' }),
      );

      const results: LaikaResult<readonly import('@laikacms/documents').Record[]>[] = [];
      for await (
        const r of repo.listRecords({ type: 'published', folder: '', pagination: { offset: 0, limit: 100 }, depth: 10 })
      ) {
        results.push(r);
      }

      const docs = results
        .filter(r => Result.isSuccess(r))
        .flatMap(r => (Result.isSuccess(r) ? [...r.success] : []));

      expect(docs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('createRevision / getRevision / listRevisions', () => {
    it('creates and retrieves a revision', async () => {
      const createResult = await firstResult(
        repo.createRevision({
          key: 'doc',
          type: 'revision',
          revision: 'v1',
          content: { original: true },
          language: 'en',
        }),
      );
      expect(Result.isSuccess(createResult)).toBe(true);

      const getResult = await firstResult(repo.getRevision('doc', 'v1'));
      expect(Result.isSuccess(getResult)).toBe(true);
      if (Result.isSuccess(getResult)) {
        expect(getResult.success.revision).toBe('v1');
        expect(getResult.success.content).toEqual({ original: true });
      }
    });

    it('returns NotFoundError for a missing revision', async () => {
      const result = await firstResult(repo.getRevision('doc', 'vXXX'));
      expect(Result.isFailure(result)).toBe(true);
    });

    it('lists revisions for a key', async () => {
      await firstResult(
        repo.createRevision({ key: 'doc', type: 'revision', revision: 'v1', content: {}, language: 'en' }),
      );
      await firstResult(
        repo.createRevision({ key: 'doc', type: 'revision', revision: 'v2', content: {}, language: 'en' }),
      );

      const results: LaikaResult<readonly import('@laikacms/documents').RevisionSummary[]>[] = [];
      for await (const r of repo.listRevisions('doc', { pagination: { offset: 0, limit: 100 } })) {
        results.push(r);
      }

      const summaries = results
        .filter(r => Result.isSuccess(r))
        .flatMap(r => (Result.isSuccess(r) ? [...r.success] : []));

      expect(summaries.length).toBe(2);
      expect(summaries.map(s => s.revision)).toContain('v1');
      expect(summaries.map(s => s.revision)).toContain('v2');
    });
  });
});
