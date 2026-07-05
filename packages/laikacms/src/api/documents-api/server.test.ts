import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type {
  DocumentsCapabilities,
  DocumentsRepository,
  ListRecordsDone,
  ListRecordsOptions,
  ListRecordSummaries,
} from 'laikacms/documents';
import { describe, expect, it, vi } from 'vitest';

import { InternalError, InvalidData, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';

import { buildJsonApi } from './server.js';

const stubRepo = {} as DocumentsRepository;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const makeDocument = (key = 'posts/hello') => ({
  type: 'published' as const,
  key,
  status: 'published' as const,
  language: 'en' as const,
  content: { title: 'Hello' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const makeUnpublished = (key = 'posts/draft') => ({
  type: 'unpublished' as const,
  key,
  status: 'draft',
  language: 'en' as const,
  content: { title: 'Draft' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const makeRevision = (key = 'posts/hello', revision = 'rev-1') => ({
  type: 'revision' as const,
  key,
  revision,
  language: 'en' as const,
  content: { title: 'Hello v1' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const makeCapabilities = (): DocumentsCapabilities => ({
  compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
  pagination: { cursor: true, offset: false },
});

describe('documents-api Cache-Control', () => {
  it('sends Cache-Control: no-store on the root API info response', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sends Cache-Control: no-store on 404 responses', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/does-not-exist'));
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('documents-api meta.warnings', () => {
  it('surfaces recoverableErrors from listRecords into the response meta.warnings', async () => {
    const partialRepo = {
      listRecords: (_options: ListRecordsOptions) =>
        LaikaStream.make<
          { type: 'published', key: string, status: string, createdAt: string, updatedAt: string, content: object },
          ListRecordsDone
        >(emit =>
          Effect.gen(function*() {
            yield* emit.data({
              type: 'published',
              key: 'posts/good',
              status: 'published',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              content: { title: 'Good post' },
            });
            yield* emit.recoverableError(new InvalidData('posts/corrupt: failed to parse content'));
            return { total: 1 };
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/records'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: Array<{ id: string }>,
      meta?: { warnings?: Array<{ code: string, detail: string }> },
    };

    expect(body.data.map(d => d.id)).toEqual(['posts/good']);
    expect(body.meta?.warnings).toHaveLength(1);
    expect(body.meta?.warnings?.[0]?.code).toBe('invalid_data');
    expect(body.meta?.warnings?.[0]?.detail).toContain('posts/corrupt');
  });

  it('surfaces recoverableErrors from deleteDocument into the void response meta.warnings', async () => {
    const partialRepo = {
      deleteDocument: (_key: string) =>
        LaikaTask.make<void>(emit =>
          Effect.gen(function*() {
            yield* emit.recoverableError(
              new InvalidData('orphaned sidecar metadata could not be cleaned up'),
            );
            return undefined;
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fhello', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      meta: { deleted: boolean, warnings?: Array<{ code: string, detail: string }> },
    };

    expect(body.meta.deleted).toBe(true);
    expect(body.meta.warnings).toHaveLength(1);
    expect(body.meta.warnings?.[0]?.code).toBe('invalid_data');
    expect(body.meta.warnings?.[0]?.detail).toContain('orphaned sidecar');
  });

  it('calls onError when a repo operation fails', async () => {
    const onError = vi.fn();
    const partialRepo = {
      getDocument: (_key: string) => LaikaTask.make(() => Effect.fail(new NotFoundError('document not found'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo, onError });
    const res = await api.fetch(new Request('http://localhost/published/missing%2Fdoc'));
    expect(res.status).toBe(404);
    expect(onError).toHaveBeenCalledOnce();
    const [calledWith] = onError.mock.calls[0]!;
    expect(calledWith).toBeInstanceOf(NotFoundError);
  });

  it('calls onError when the repo throws an unexpected synchronous error', async () => {
    const onError = vi.fn();
    const partialRepo = {
      getDocument: (_key: string) => {
        throw new Error('unexpected synchronous defect');
      },
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo, onError });
    const res = await api.fetch(new Request('http://localhost/published/boom'));
    expect(res.status).toBe(400);
    expect(onError).toHaveBeenCalledOnce();
    const [calledWith] = onError.mock.calls[0]!;
    expect(calledWith).toBeInstanceOf(Error);
    expect((calledWith as Error).message).toBe('unexpected synchronous defect');
  });

  it('surfaces recoverableErrors on per-op meta.warnings for atomic remove results', async () => {
    const partialRepo = {
      deleteDocument: (_key: string) =>
        LaikaTask.make<void>(emit =>
          Effect.gen(function*() {
            yield* emit.recoverableError(
              new InvalidData('orphaned sidecar metadata could not be cleaned up'),
            );
            return undefined;
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          'atomic:operations': [
            { op: 'remove', ref: { type: 'document', id: 'posts/old' } },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      'atomic:results': Array<{
        meta?: {
          deleted?: boolean,
          ref?: { type: string, id: string },
          warnings?: Array<{ code: string, detail: string }>,
        },
      }>,
    };

    expect(body['atomic:results']).toHaveLength(1);
    expect(body['atomic:results'][0]?.meta?.deleted).toBe(true);
    expect(body['atomic:results'][0]?.meta?.ref?.id).toBe('posts/old');
    expect(body['atomic:results'][0]?.meta?.warnings).toHaveLength(1);
    expect(body['atomic:results'][0]?.meta?.warnings?.[0]?.code).toBe('invalid_data');
    expect(body['atomic:results'][0]?.meta?.warnings?.[0]?.detail).toContain('orphaned sidecar');
  });
});

// ---------------------------------------------------------------------------
// GET / — root info
// ---------------------------------------------------------------------------

describe('GET /', () => {
  it('returns 200 with api-info resource', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string, attributes: { name: string } } };
    expect(body.data.type).toBe('api-info');
    expect(body.data.id).toBe('documents');
    expect(body.data.attributes.name).toBe('Documents API');
  });
});

// ---------------------------------------------------------------------------
// GET /capabilities
// ---------------------------------------------------------------------------

describe('GET /capabilities', () => {
  it('returns 200 with documents-capabilities resource', async () => {
    const repo = {
      getCapabilities: () => LaikaTask.make(() => Effect.succeed(makeCapabilities())),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/capabilities'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: { type: string, id: string, attributes: { compatibilityDate: string } },
    };
    expect(body.data.type).toBe('documents-capabilities');
    expect(body.data.id).toBe('self');
    expect(body.data.attributes.compatibilityDate).toBe('2026-01-01');
  });

  it('returns JSON:API error shape when repo fails', async () => {
    const repo = {
      getCapabilities: () => LaikaTask.make(() => Effect.fail(new NotFoundError('capabilities unavailable'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/capabilities'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });
});

// ---------------------------------------------------------------------------
// GET /published/:key
// ---------------------------------------------------------------------------

describe('GET /published/:key', () => {
  it('returns 200 with published resource', async () => {
    const doc = makeDocument();
    const repo = {
      getDocument: (_key: string) => LaikaTask.make(() => Effect.succeed(doc)),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/published/posts%2Fhello'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('published');
    expect(body.data.id).toBe('posts/hello');
  });

  it('returns 404 JSON:API error when document not found', async () => {
    const repo = {
      getDocument: (_key: string) => LaikaTask.make(() => Effect.fail(new NotFoundError('document not found'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/published/posts%2Fmissing'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });
});

// ---------------------------------------------------------------------------
// POST /published — create
// ---------------------------------------------------------------------------

describe('POST /published', () => {
  it('returns 201 on successful document creation', async () => {
    const doc = makeDocument('posts/new');
    const repo = {
      createDocument: vi.fn(() => LaikaTask.make(() => Effect.succeed(doc))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/published', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'published',
            id: 'posts/new',
            attributes: { status: 'published', content: { title: 'Hello' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('published');
    expect(body.data.id).toBe('posts/new');
  });

  it('returns 400 JSON:API error on invalid body', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/published', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'wrong-type', id: 'x', attributes: {} } }),
      }),
    );
    // Schema decode throws; outer catch wraps as InternalError — HTTP 400 response
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    // InternalError maps to status 500 in the JSON:API error body
    expect(body.errors[0]!.status).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// PATCH /published/:key — update
// ---------------------------------------------------------------------------

describe('PATCH /published/:key', () => {
  it('returns 200 on successful document update', async () => {
    const doc = makeDocument('posts/hello');
    const repo = {
      updateDocument: vi.fn(() => LaikaTask.make(() => Effect.succeed(doc))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fhello', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'published',
            id: 'posts/hello',
            attributes: { status: 'published', content: { title: 'Updated' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('published');
    expect(body.data.id).toBe('posts/hello');
  });
});

// ---------------------------------------------------------------------------
// DELETE /published/:key
// ---------------------------------------------------------------------------

describe('DELETE /published/:key', () => {
  it('returns 200 with meta.deleted on successful delete', async () => {
    const repo = {
      deleteDocument: vi.fn((_key: string) => LaikaTask.make(() => Effect.succeed(undefined))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fhello', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { meta: { deleted: boolean } };
    expect(body.meta.deleted).toBe(true);
  });

  it('returns JSON:API error when document not found', async () => {
    const repo = {
      deleteDocument: vi.fn((_key: string) =>
        LaikaTask.make(() => Effect.fail(new NotFoundError('document not found')))
      ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fmissing', { method: 'DELETE' }),
    );
    // respondVoid calls respondError with no explicit status — defaults to 400
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });
});

// ---------------------------------------------------------------------------
// POST /unpublished/:key/publish — state transition
// ---------------------------------------------------------------------------

describe('POST /unpublished/:key/publish', () => {
  it('returns 200 with published resource after publishing', async () => {
    const doc = makeDocument('posts/hello');
    const repo = {
      publish: vi.fn((_key: string) => LaikaTask.make(() => Effect.succeed(doc))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fhello/publish', { method: 'POST' }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('published');
    expect(body.data.id).toBe('posts/hello');
  });

  it('returns 404 JSON:API error when draft not found', async () => {
    const repo = {
      publish: vi.fn((_key: string) => LaikaTask.make(() => Effect.fail(new NotFoundError('unpublished not found')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fmissing/publish', { method: 'POST' }),
    );
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });
});

// ---------------------------------------------------------------------------
// POST /unpublished — create draft
// ---------------------------------------------------------------------------

describe('POST /unpublished', () => {
  it('returns 201 on successful draft creation', async () => {
    const draft = makeUnpublished('posts/draft');
    const repo = {
      createUnpublished: vi.fn(() => LaikaTask.make(() => Effect.succeed(draft))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/unpublished', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'unpublished',
            id: 'posts/draft',
            attributes: { status: 'draft', content: { title: 'Draft' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('unpublished');
    expect(body.data.id).toBe('posts/draft');
  });

  it('returns 400 JSON:API error on invalid body', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/unpublished', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'published', id: 'x', attributes: {} } }),
      }),
    );
    // Schema decode throws; outer catch wraps as InternalError — HTTP 400 response
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    // InternalError maps to status 500 in the JSON:API error body
    expect(body.errors[0]!.status).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// POST /revisions — create revision
// ---------------------------------------------------------------------------

describe('POST /revisions', () => {
  it('returns 201 on successful revision creation', async () => {
    const rev = makeRevision('posts/hello', 'rev-1');
    const repo = {
      createRevision: vi.fn(() => LaikaTask.make(() => Effect.succeed(rev))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'revision',
            id: 'posts/hello',
            attributes: { revision: 'rev-1', content: { title: 'Hello v1' }, createdAt: '2026-01-01T00:00:00Z' },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('revision');
    expect(body.data.id).toBe('posts/hello');
  });

  it('returns 400 JSON:API error on invalid body', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'published', id: 'x', attributes: {} } }),
      }),
    );
    // Schema decode throws; outer catch wraps as InternalError — HTTP 400 response
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    // InternalError maps to status 500 in the JSON:API error body
    expect(body.errors[0]!.status).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// 404 on unknown endpoint
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

describe('GET /record-summaries', () => {
  it('returns 200 with published-summary and unpublished-summary types from correct backends', async () => {
    const partialRepo = {
      listRecordSummaries: (_options: ListRecordSummaries) =>
        LaikaStream.make<
          {
            type: 'published-summary' | 'unpublished-summary',
            key: string,
            status: string,
            language: string,
            createdAt: string,
            updatedAt: string,
          },
          ListRecordsDone
        >(emit =>
          Effect.gen(function*() {
            yield* emit.data({
              type: 'published-summary',
              key: 'posts/hello',
              status: 'published',
              language: 'en',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            });
            yield* emit.data({
              type: 'unpublished-summary',
              key: 'posts/draft',
              status: 'draft',
              language: 'en',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            });
            return { total: 2 };
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/record-summaries'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Array<{ id: string, type: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]!.type).toBe('published-summary');
    expect(body.data[0]!.id).toBe('posts/hello');
    expect(body.data[1]!.type).toBe('unpublished-summary');
    expect(body.data[1]!.id).toBe('posts/draft');
  });

  it('returns 200 with published/unpublished types from drizzle-shaped backends (backward compat)', async () => {
    const partialRepo = {
      listRecordSummaries: (_options: ListRecordSummaries) =>
        LaikaStream.make<
          {
            type: 'published' | 'unpublished',
            key: string,
            status: string,
            language: string,
            createdAt: string,
            updatedAt: string,
          },
          ListRecordsDone
        >(emit =>
          Effect.gen(function*() {
            yield* emit.data({
              type: 'published',
              key: 'posts/hello',
              status: 'published',
              language: 'en',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            });
            yield* emit.data({
              type: 'unpublished',
              key: 'posts/draft',
              status: 'draft',
              language: 'en',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            });
            return { total: 2 };
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/record-summaries'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Array<{ id: string, type: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]!.type).toBe('published-summary');
    expect(body.data[0]!.id).toBe('posts/hello');
    expect(body.data[1]!.type).toBe('unpublished-summary');
    expect(body.data[1]!.id).toBe('posts/draft');
  });
});

// ---------------------------------------------------------------------------
// GET /records — error status mapping (LCMS-186)
// ---------------------------------------------------------------------------

describe('GET /records — error HTTP status', () => {
  it('returns HTTP 404 (not 400) when the repo raises NotFoundError', async () => {
    const partialRepo = {
      listRecords: () => LaikaStream.make(() => Effect.fail(new NotFoundError('config not found'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/records'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('404');
    expect(body.errors[0]!.code).toBe('not_found');
  });

  it('returns HTTP 500 (not 400) when the repo raises InternalError', async () => {
    const partialRepo = {
      listRecords: () => LaikaStream.make(() => Effect.fail(new InternalError('unexpected failure'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/records'));
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('500');
    expect(body.errors[0]!.code).toBe('internal_error');
  });
});

// ---------------------------------------------------------------------------
// GET /record-summaries — error status mapping (LCMS-186)
// ---------------------------------------------------------------------------

describe('GET /record-summaries — error HTTP status', () => {
  it('returns HTTP 404 (not 400) when the repo raises NotFoundError', async () => {
    const partialRepo = {
      listRecordSummaries: () => LaikaStream.make(() => Effect.fail(new NotFoundError('config not found'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/record-summaries'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('404');
    expect(body.errors[0]!.code).toBe('not_found');
  });

  it('returns HTTP 500 (not 400) when the repo raises InternalError', async () => {
    const partialRepo = {
      listRecordSummaries: () => LaikaStream.make(() => Effect.fail(new InternalError('unexpected failure'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/record-summaries'));
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('500');
    expect(body.errors[0]!.code).toBe('internal_error');
  });
});

// ---------------------------------------------------------------------------

describe('404 on unknown routes', () => {
  it('returns 404 JSON:API error shape on unknown path', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/unknown-resource'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, title: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });
});
