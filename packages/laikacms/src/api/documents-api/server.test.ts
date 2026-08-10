import * as Effect from 'effect/Effect';
import * as S from 'effect/Schema';
import type {
  DocumentsCapabilities,
  DocumentsRepository,
  ListRecordsDone,
  ListRecordsOptions,
  ListRecordSummaries,
  ListRevisionsDone,
  RevisionSummary,
} from 'laikacms/documents';
import { describe, expect, it, vi } from 'vitest';
import { allowAll } from '../../shared/json-api/authorize.js';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  InternalError,
  InvalidData,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';

import { InMemoryDocumentsRepository } from '../../domain/documents/testing/in-memory-documents.js';

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
  pagination: {
    supported: true,
    description: 'cursor-only for tests',
    styles: { offset: false, page: false, cursor: true },
  },
});

describe('documents-api Cache-Control', () => {
  it('sends Cache-Control: no-store on the root API info response', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sends Cache-Control: no-store on 404 responses', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
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

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
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

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
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

    const api = buildJsonApi({ repo: partialRepo, onError, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/published/missing%2Fdoc'));
    expect(res.status).toBe(404);
    expect(onError).toHaveBeenCalledOnce();
    const [calledWith] = onError.mock.calls[0]!;
    expect(calledWith).toBeInstanceOf(NotFoundError);
  });

  it('returns 500 (not 400) and calls onError when the repo throws an unexpected synchronous error (LCMS-275)', async () => {
    const onError = vi.fn();
    const partialRepo = {
      getDocument: (_key: string) => {
        throw new Error('unexpected synchronous defect');
      },
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo, onError, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/published/boom'));
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
    const [calledWith] = onError.mock.calls[0]!;
    expect(calledWith).toBeInstanceOf(Error);
    expect((calledWith as Error).message).toBe('unexpected synchronous defect');
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('500');
    expect(body.errors[0]!.code).toBe('internal_error');
  });

  it(
    'returns 400 invalid_data (not 500 internal_error) when a repo throws an Effect Schema decode error (LCMS-264)',
    async () => {
      const onError = vi.fn();
      const partialRepo = {
        getDocument: (_key: string) => {
          // Simulate a repo implementation that decodes something internally
          // (e.g. a stored envelope) and lets the ParseError-equivalent throw
          // escape as a synchronous defect — same shape as a body-decoder
          // throw, but reaching `toLaikaError` via the outer fetch catch
          // rather than the `parseBody`/`parseQuery` helpers.
          S.decodeUnknownSync(S.Struct({ type: S.Literal('published') }))({ type: 'WRONG' });
          throw new Error('unreachable');
        },
      } as unknown as DocumentsRepository;

      const api = buildJsonApi({ repo: partialRepo, onError, authorize: allowAll });
      const res = await api.fetch(new Request('http://localhost/published/boom'));
      expect(res.status).toBe(400);
      expect(onError).toHaveBeenCalledOnce();

      const body = await res.json() as { errors: Array<{ status: string, code: string, title: string }> };
      expect(body.errors[0]!.status).toBe('400');
      expect(body.errors[0]!.code).toBe('invalid_data');
      expect(body.errors[0]!.title).toBe('Invalid Data');
    },
  );

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

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          'operations': [
            { op: 'remove', ref: { type: 'document', id: 'posts/old' } },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      results: Array<{
        meta?: {
          deleted?: boolean,
          ref?: { type: string, id: string },
          warnings?: Array<{ code: string, detail: string }>,
        },
      }>,
    };

    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.meta?.deleted).toBe(true);
    expect(body.results[0]?.meta?.ref?.id).toBe('posts/old');
    expect(body.results[0]?.meta?.warnings).toHaveLength(1);
    expect(body.results[0]?.meta?.warnings?.[0]?.code).toBe('invalid_data');
    expect(body.results[0]?.meta?.warnings?.[0]?.detail).toContain('orphaned sidecar');
  });
});

// ---------------------------------------------------------------------------
// GET / — root info
// ---------------------------------------------------------------------------

describe('GET /', () => {
  it('returns 200 with api-info resource', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
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

    const api = buildJsonApi({ repo, authorize: allowAll });
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

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/capabilities'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });

  it('returns 500 JSON:API error when repo throws InternalError on getCapabilities', async () => {
    const repo = {
      getCapabilities: () => LaikaTask.make(() => Effect.fail(new InternalError('storage unavailable'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/capabilities'));
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
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

    const api = buildJsonApi({ repo, authorize: allowAll });
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

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/published/posts%2Fmissing'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });

  it('returns 500 JSON:API error when repo throws InternalError on get', async () => {
    const repo = {
      getDocument: (_key: string) => LaikaTask.make(() => Effect.fail(new InternalError('storage unavailable'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/published/posts%2Fhello'));
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
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

    const api = buildJsonApi({ repo, authorize: allowAll });
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

  it('returns 400 invalid_data on wrong data.type', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'wrong-type', id: 'x', attributes: {} } }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('invalid_data');
  });

  it('returns 400 invalid_data on malformed JSON body', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: '{bad',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('invalid_data');
  });

  it('returns 409 JSON:API error when document already exists', async () => {
    const repo = {
      createDocument: vi.fn(() =>
        LaikaTask.make(() => Effect.fail(new EntryAlreadyExistsError('document already exists')))
      ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'published',
            id: 'posts/existing',
            attributes: { status: 'published', content: { title: 'Hello' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(409);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('409');
  });

  it('returns 500 JSON:API error when repo throws InternalError', async () => {
    const repo = {
      createDocument: vi.fn(() => LaikaTask.make(() => Effect.fail(new InternalError('db write failed')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
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
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
  });

  it('returns 400 bad_request when data.id is omitted (LCMS-397)', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'published',
            attributes: { status: 'published', content: { title: 'Hello' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string, detail: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('bad_request');
    expect(body.errors[0]!.detail).toMatch(/data\.id is required/);
  });

  it('defaults language to "und" when omitted (LCMS-511)', async () => {
    let captured: unknown;
    const doc = makeDocument('posts/new');
    const repo = {
      createDocument: vi.fn((data: unknown) => {
        captured = data;
        return LaikaTask.make(() => Effect.succeed(doc));
      }),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    await api.fetch(
      new Request('http://localhost/published', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'published', id: 'posts/new', attributes: { content: { title: 'Hello' } } },
        }),
      }),
    );
    expect((captured as { language: string }).language).toBe('und');
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

    const api = buildJsonApi({ repo, authorize: allowAll });
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

  it('returns 400 invalid_data on malformed JSON body', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fhello', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: '{bad',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('invalid_data');
  });

  it('returns 404 JSON:API error when document not found', async () => {
    const repo = {
      updateDocument: vi.fn(() => LaikaTask.make(() => Effect.fail(new NotFoundError('document not found')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fmissing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'published',
            id: 'posts/missing',
            attributes: { status: 'published', content: { title: 'Updated' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });

  it('returns 500 JSON:API error when repo throws InternalError on update', async () => {
    const repo = {
      updateDocument: vi.fn(() => LaikaTask.make(() => Effect.fail(new InternalError('storage failure')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
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
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
  });

  it('returns 400 when data.id is missing (LCMS-403)', async () => {
    const repo = {
      updateDocument: vi.fn(() => LaikaTask.make(() => Effect.succeed(makeDocument('posts/hello')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fhello', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'published',
            attributes: { status: 'published', content: { title: 'Updated' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(repo.updateDocument).not.toHaveBeenCalled();
  });

  it('returns 409 when data.id does not match the URL key (LCMS-403)', async () => {
    const repo = {
      updateDocument: vi.fn(() => LaikaTask.make(() => Effect.succeed(makeDocument('posts/hello')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fhello', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'published',
            id: 'posts/other',
            attributes: { status: 'published', content: { title: 'Updated' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('409');
    expect(repo.updateDocument).not.toHaveBeenCalled();
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

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fhello', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { meta: { deleted: boolean } };
    expect(body.meta.deleted).toBe(true);
  });

  it('returns 404 JSON:API error when document not found', async () => {
    const repo = {
      deleteDocument: vi.fn((_key: string) =>
        LaikaTask.make(() => Effect.fail(new NotFoundError('document not found')))
      ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fmissing', { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });

  it('returns 500 JSON:API error when repo throws InternalError', async () => {
    const repo = {
      deleteDocument: vi.fn((_key: string) =>
        LaikaTask.make(() => Effect.fail(new InternalError('db connection lost')))
      ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fhello', { method: 'DELETE' }),
    );
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
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

    const api = buildJsonApi({ repo, authorize: allowAll });
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

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fmissing/publish', { method: 'POST' }),
    );
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });

  it('returns 500 JSON:API error when repo throws InternalError on publish', async () => {
    const repo = {
      publish: vi.fn((_key: string) => LaikaTask.make(() => Effect.fail(new InternalError('storage failure')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fhello/publish', { method: 'POST' }),
    );
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
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

    const api = buildJsonApi({ repo, authorize: allowAll });
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

  it('returns 400 invalid_data on wrong data.type', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'published', id: 'x', attributes: {} } }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('invalid_data');
  });

  it('returns 400 invalid_data on malformed JSON body', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: '{bad',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('invalid_data');
  });

  it('returns 400 bad_request when data.id is omitted (LCMS-397)', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'unpublished',
            attributes: { status: 'draft', content: { title: 'Draft' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string, detail: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('bad_request');
    expect(body.errors[0]!.detail).toMatch(/data\.id is required/);
  });

  it('returns 500 JSON:API error when repo throws InternalError on createUnpublished', async () => {
    const repo = {
      createUnpublished: vi.fn(() => LaikaTask.make(() => Effect.fail(new InternalError('storage failure')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
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
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
  });

  it('defaults language to "und" when omitted (LCMS-511)', async () => {
    let captured: unknown;
    const draft = makeUnpublished('posts/draft');
    const repo = {
      createUnpublished: vi.fn((data: unknown) => {
        captured = data;
        return LaikaTask.make(() => Effect.succeed(draft));
      }),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    await api.fetch(
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
    expect((captured as { language: string }).language).toBe('und');
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

    const api = buildJsonApi({ repo, authorize: allowAll });
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
    expect(body.data.id).toBe('posts/hello/rev-1');
  });

  it('returns 400 invalid_data on wrong data.type', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'published', id: 'x', attributes: {} } }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('invalid_data');
  });

  it('returns 400 invalid_data on malformed JSON body', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: '{bad',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('invalid_data');
  });

  it('returns 400 bad_request when data.id is omitted (LCMS-393)', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'revision',
            attributes: { revision: 'v1', language: 'en', content: { title: 'Hello' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string, detail: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('bad_request');
    expect(body.errors[0]!.detail).toMatch(/data\.id is required/);
  });

  it('returns 400 bad_request when attributes.revision is omitted (LCMS-284)', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'revision',
            id: 'posts/hello',
            attributes: { content: { title: 'LOST' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string, detail: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('bad_request');
    expect(body.errors[0]!.detail).toMatch(/attributes\.revision is required/);
  });

  it('defaults language to "und" when omitted (LCMS-511)', async () => {
    let captured: unknown;
    const rev = makeRevision('posts/hello', 'rev-1');
    const repo = {
      createRevision: vi.fn((data: unknown) => {
        captured = data;
        return LaikaTask.make(() => Effect.succeed(rev));
      }),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    await api.fetch(
      new Request('http://localhost/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'revision', id: 'posts/hello', attributes: { revision: 'rev-1', content: { title: 'Hello' } } },
        }),
      }),
    );
    expect((captured as { language: string }).language).toBe('und');
  });
});

describe('POST /revisions — repo failure', () => {
  const body = JSON.stringify({
    data: {
      type: 'revision',
      id: 'posts/hello',
      attributes: { revision: 'rev-1', content: { title: 'Hello v1' }, createdAt: '2026-01-01T00:00:00Z' },
    },
  });
  const headers = { 'Content-Type': 'application/vnd.api+json' };

  it('returns 404 when createRevision raises NotFoundError', async () => {
    const repo = {
      createRevision: vi.fn(() => LaikaTask.make(() => Effect.fail(new NotFoundError('document not found')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions', { method: 'POST', headers, body }));
    expect(res.status).toBe(404);
    const json = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(json.errors[0]!.status).toBe('404');
    expect(json.errors[0]!.code).toBe('not_found');
  });

  it('returns 500 when createRevision raises InternalError', async () => {
    const repo = {
      createRevision: vi.fn(() => LaikaTask.make(() => Effect.fail(new InternalError('storage unavailable')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions', { method: 'POST', headers, body }));
    expect(res.status).toBe(500);
    const json = await res.json() as { errors: Array<{ status: string }> };
    expect(json.errors[0]!.status).toBe('500');
  });

  it('returns 400 when createRevision raises BadRequestError', async () => {
    const repo = {
      createRevision: vi.fn(() => LaikaTask.make(() => Effect.fail(new BadRequestError('invalid revision data')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions', { method: 'POST', headers, body }));
    expect(res.status).toBe(400);
    const json = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(json.errors[0]!.status).toBe('400');
    expect(json.errors[0]!.code).toBe('bad_request');
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

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
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

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/record-summaries'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Array<{ id: string, type: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]!.type).toBe('published-summary');
    expect(body.data[0]!.id).toBe('posts/hello');
    expect(body.data[1]!.type).toBe('unpublished-summary');
    expect(body.data[1]!.id).toBe('posts/draft');
  });

  it(
    'returns 200 (not 500 "Unknown entry type") once a real repo has >=1 entry (LCMS-267)',
    async () => {
      // Regression for LCMS-267: a real repo (like CatalogDocumentsRepository)
      // emits already-suffixed `published-summary` / `unpublished-summary` entry
      // types from listRecordSummaries. Wiring a real repo through buildJsonApi
      // end-to-end reproduces the original 500 "Unknown entry type:
      // published-summary" as soon as the collection has at least one document.
      const repo = new InMemoryDocumentsRepository();
      await LaikaTask.runPromise(
        repo.createDocument({
          key: 'posts/hello',
          type: 'published',
          status: 'published',
          content: { title: 'Hello' },
          language: 'en',
        }),
      );

      const api = buildJsonApi({ repo, authorize: allowAll });
      const res = await api.fetch(new Request('http://localhost/record-summaries?filter%5Bfolder%5D=posts'));
      expect(res.status).toBe(200);

      const body = await res.json() as { data: Array<{ id: string, type: string }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.type).toBe('published-summary');
      expect(body.data[0]!.id).toBe('posts/hello');
    },
  );
});

// ---------------------------------------------------------------------------
// GET /records — error status mapping (LCMS-186)
// ---------------------------------------------------------------------------

describe('GET /records — error HTTP status', () => {
  it('returns HTTP 404 (not 400) when the repo raises NotFoundError', async () => {
    const partialRepo = {
      listRecords: () => LaikaStream.make(() => Effect.fail(new NotFoundError('config not found'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
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

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/records'));
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('500');
    expect(body.errors[0]!.code).toBe('internal_error');
  });
});

// ---------------------------------------------------------------------------
// GET /records — missing filter[folder] (LCMS-268)
// ---------------------------------------------------------------------------

describe('GET /records — missing filter[folder]', () => {
  it('returns 400 bad_request when repo raises BadRequestError for empty folder', async () => {
    const partialRepo = {
      listRecords: () =>
        LaikaStream.make(() =>
          Effect.fail(
            new BadRequestError(
              'listRecords requires `folder` (the collection name) to identify which collection to list',
            ),
          )
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/records'));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('bad_request');
  });

  it('returns 400 bad_request when repo raises BadRequestError for empty filter[folder]=""', async () => {
    const partialRepo = {
      listRecords: () =>
        LaikaStream.make(() =>
          Effect.fail(
            new BadRequestError('listRecords requires `folder`'),
          )
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/records?filter%5Bfolder%5D='));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('bad_request');
  });
});

// ---------------------------------------------------------------------------
// GET /record-summaries — missing filter[folder] (LCMS-268)
// ---------------------------------------------------------------------------

describe('GET /record-summaries — missing filter[folder]', () => {
  it('returns 400 bad_request when repo raises BadRequestError for empty folder', async () => {
    const partialRepo = {
      listRecordSummaries: () =>
        LaikaStream.make(() =>
          Effect.fail(
            new BadRequestError('listRecords requires `folder`'),
          )
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/record-summaries'));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('bad_request');
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

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
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

    const api = buildJsonApi({ repo: partialRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/record-summaries'));
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('500');
    expect(body.errors[0]!.code).toBe('internal_error');
  });
});

// ---------------------------------------------------------------------------
// GET /unpublished/:key (LCMS-187)
// ---------------------------------------------------------------------------

describe('GET /unpublished/:key', () => {
  it('returns 200 with unpublished resource', async () => {
    const draft = makeUnpublished('posts/draft');
    const repo = {
      getUnpublished: (_key: string) => LaikaTask.make(() => Effect.succeed(draft)),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/unpublished/posts%2Fdraft'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('unpublished');
    expect(body.data.id).toBe('posts/draft');
  });

  it('returns 404 JSON:API error when draft not found', async () => {
    const repo = {
      getUnpublished: (_key: string) => LaikaTask.make(() => Effect.fail(new NotFoundError('draft not found'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/unpublished/posts%2Fmissing'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });

  it('returns 500 JSON:API error when repo throws InternalError on getUnpublished', async () => {
    const repo = {
      getUnpublished: (_key: string) => LaikaTask.make(() => Effect.fail(new InternalError('storage failure'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/unpublished/posts%2Fdraft'));
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// PATCH /unpublished/:key (LCMS-187)
// ---------------------------------------------------------------------------

describe('PATCH /unpublished/:key', () => {
  it('returns 200 with updated unpublished resource', async () => {
    const draft = makeUnpublished('posts/draft');
    const repo = {
      updateUnpublished: vi.fn(() => LaikaTask.make(() => Effect.succeed(draft))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fdraft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'unpublished',
            id: 'posts/draft',
            attributes: { status: 'draft', content: { title: 'Updated Draft' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('unpublished');
    expect(body.data.id).toBe('posts/draft');
  });

  it('returns 404 JSON:API error when draft not found', async () => {
    const repo = {
      updateUnpublished: vi.fn(() => LaikaTask.make(() => Effect.fail(new NotFoundError('draft not found')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fmissing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'unpublished',
            id: 'posts/missing',
            attributes: { status: 'draft', content: { title: 'Updated Draft' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });

  it('returns 500 JSON:API error when repo throws InternalError on updateUnpublished', async () => {
    const repo = {
      updateUnpublished: vi.fn(() => LaikaTask.make(() => Effect.fail(new InternalError('storage failure')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fdraft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'unpublished',
            id: 'posts/draft',
            attributes: { status: 'draft', content: { title: 'Updated Draft' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
  });

  it('returns 400 invalid_data on malformed JSON body', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fdraft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: '{bad',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('invalid_data');
  });

  it('returns 400 when data.id is missing (LCMS-403)', async () => {
    const repo = {
      updateUnpublished: vi.fn(() => LaikaTask.make(() => Effect.succeed(makeUnpublished('posts/draft')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fdraft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'unpublished',
            attributes: { status: 'draft', content: { title: 'Updated Draft' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(repo.updateUnpublished).not.toHaveBeenCalled();
  });

  it('returns 409 when data.id does not match the URL key (LCMS-403)', async () => {
    const repo = {
      updateUnpublished: vi.fn(() => LaikaTask.make(() => Effect.succeed(makeUnpublished('posts/draft')))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fdraft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'unpublished',
            id: 'posts/other',
            attributes: { status: 'draft', content: { title: 'Updated Draft' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('409');
    expect(repo.updateUnpublished).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /unpublished/:key (LCMS-187)
// ---------------------------------------------------------------------------

describe('DELETE /unpublished/:key', () => {
  it('returns 200 with meta.deleted on successful delete', async () => {
    const repo = {
      deleteUnpublished: vi.fn((_key: string) => LaikaTask.make(() => Effect.succeed(undefined))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fdraft', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { meta: { deleted: boolean } };
    expect(body.meta.deleted).toBe(true);
  });

  it('returns 404 JSON:API error when unpublished document not found', async () => {
    const repo = {
      deleteUnpublished: vi.fn((_key: string) =>
        LaikaTask.make(() => Effect.fail(new NotFoundError('unpublished document not found')))
      ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fmissing', { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });

  it('returns 500 JSON:API error when repo throws InternalError', async () => {
    const repo = {
      deleteUnpublished: vi.fn((_key: string) =>
        LaikaTask.make(() => Effect.fail(new InternalError('storage failure')))
      ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/unpublished/posts%2Fdraft', { method: 'DELETE' }),
    );
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// POST /published/:key/unpublish (LCMS-187)
// ---------------------------------------------------------------------------

describe('POST /published/:key/unpublish', () => {
  it('returns 200 with unpublished resource after unpublishing', async () => {
    const draft = makeUnpublished('posts/hello');
    const repo = {
      unpublish: vi.fn((_key: string, _status: string) => LaikaTask.make(() => Effect.succeed(draft))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fhello/unpublish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'unpublished', attributes: { status: 'draft' } },
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('unpublished');
    expect(body.data.id).toBe('posts/hello');
  });

  it('returns 404 JSON:API error when published document not found', async () => {
    const repo = {
      unpublish: vi.fn((_key: string, _status: string) =>
        LaikaTask.make(() => Effect.fail(new NotFoundError('document not found')))
      ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fmissing/unpublish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'unpublished', attributes: { status: 'draft' } },
        }),
      }),
    );
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });

  it('returns 500 JSON:API error when repo throws InternalError on unpublish', async () => {
    const repo = {
      unpublish: vi.fn((_key: string, _status: string) =>
        LaikaTask.make(() => Effect.fail(new InternalError('storage failure')))
      ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/published/posts%2Fhello/unpublish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'unpublished', attributes: { status: 'draft' } },
        }),
      }),
    );
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// GET /revisions/:key (LCMS-188)
// ---------------------------------------------------------------------------

const makeRevisionSummary = (key = 'posts/hello', revision = 'rev-1'): RevisionSummary => ({
  type: 'revision-summary' as const,
  key,
  revision,
  language: 'en' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('GET /revisions/:key', () => {
  it('returns 200 with revision-summary collection and meta.page.total', async () => {
    const summaries = [makeRevisionSummary('posts/hello', 'rev-1'), makeRevisionSummary('posts/hello', 'rev-2')];
    const repo = {
      listRevisions: (_key: string, _options: unknown) =>
        LaikaStream.make<RevisionSummary, ListRevisionsDone>(emit =>
          Effect.gen(function*() {
            for (const s of summaries) yield* emit.data(s);
            return { total: 2 };
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: Array<{ type: string, id: string }>,
      meta: { page: { total: number } },
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]!.type).toBe('revision-summary');
    expect(body.data[0]!.id).toBe('posts/hello/rev-1');
    expect(body.data[1]!.id).toBe('posts/hello/rev-2');
    expect(body.meta.page.total).toBe(2);
  });

  it('returns 200 with empty data array when no revisions exist', async () => {
    const repo = {
      listRevisions: (_key: string, _options: unknown) =>
        LaikaStream.make<RevisionSummary, ListRevisionsDone>(_emit => Effect.succeed({ total: 0 })),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fempty'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[], meta: { page: { total: number } } };
    expect(body.data).toHaveLength(0);
    expect(body.meta.page.total).toBe(0);
  });

  it('returns 404 when the repo raises NotFoundError', async () => {
    const repo = {
      listRevisions: (_key: string, _options: unknown) =>
        LaikaStream.make<RevisionSummary, ListRevisionsDone>(() =>
          Effect.fail(new NotFoundError('document not found'))
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fmissing'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('404');
    expect(body.errors[0]!.code).toBe('not_found');
  });

  it('returns 500 JSON:API error when repo throws InternalError on listRevisions', async () => {
    const repo = {
      listRevisions: (_key: string, _options: unknown) =>
        LaikaStream.make<RevisionSummary, ListRevisionsDone>(() => Effect.fail(new InternalError('storage failure'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello'));
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// LCMS-286 — revision ids and self-links must be unique per revision
// ---------------------------------------------------------------------------

describe('LCMS-286 — revision collection ids and self-links are unique', () => {
  it('emits unique composite ids and per-revision self-links for a 3-revision list', async () => {
    const summaries = [
      makeRevisionSummary('posts/hello', 'rev-a'),
      makeRevisionSummary('posts/hello', 'rev-b'),
      makeRevisionSummary('posts/hello', 'rev-c'),
    ];
    const repo = {
      listRevisions: (_key: string, _options: unknown) =>
        LaikaStream.make<RevisionSummary, ListRevisionsDone>(emit =>
          Effect.gen(function*() {
            for (const s of summaries) yield* emit.data(s);
            return { total: 3 };
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: Array<{ type: string, id: string, links: { self: string }, attributes: { key: string, revision: string } }>,
    };
    expect(body.data).toHaveLength(3);

    const ids = body.data.map(d => d.id);
    expect(new Set(ids).size).toBe(3);

    expect(ids[0]).toBe('posts/hello/rev-a');
    expect(ids[1]).toBe('posts/hello/rev-b');
    expect(ids[2]).toBe('posts/hello/rev-c');

    // each self-link must point to the individual revision URL
    for (const item of body.data) {
      const revisionId = item.attributes.revision;
      expect(item.links.self).toMatch(new RegExp(`/revisions/[^/]+/${encodeURIComponent(revisionId)}$`));
    }
  });

  it('single-revision GET returns composite id and self-link pointing to its own URL', async () => {
    const rev = makeRevision('posts/hello', 'rev-a');
    const repo = {
      getRevision: (_key: string, _revisionId: string) => LaikaTask.make(() => Effect.succeed(rev)),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello/rev-a'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: { type: string, id: string, links: { self: string }, attributes: { key: string, revision: string } },
    };
    expect(body.data.id).toBe('posts/hello/rev-a');
    expect(body.data.attributes.key).toBe('posts/hello');
    expect(body.data.attributes.revision).toBe('rev-a');
    expect(body.data.links.self).toMatch(/\/revisions\/[^/]+\/rev-a$/);
  });
});

// ---------------------------------------------------------------------------
// GET /revisions/:key — cursor capability guard (LCMS-266)
// ---------------------------------------------------------------------------

describe('GET /revisions/:key — cursor capability guard', () => {
  it('forwards page[after] to repo pagination.after when backend supports cursor', async () => {
    const spy = vi.fn((_key: string, _options: unknown) =>
      LaikaStream.make<RevisionSummary, ListRevisionsDone>(_emit => Effect.succeed({ total: 0 }))
    );
    const repo = {
      listRevisions: spy,
      getCapabilities: () =>
        LaikaTask.succeed<DocumentsCapabilities>({
          compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
          pagination: {
            supported: true,
            description: 'cursor supported',
            styles: { offset: false, page: false, cursor: true },
          },
        }),
    } as unknown as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello?page%5Bafter%5D=cursor-abc'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    const pagination = spy.mock.calls[0]![1] as { pagination?: { after?: string } };
    expect(pagination.pagination?.after).toBe('cursor-abc');
  });

  it('returns 400 for page[after] when backend does not support cursor', async () => {
    const listSpy = vi.fn();
    const repo = {
      listRevisions: listSpy,
      getCapabilities: () =>
        LaikaTask.succeed<DocumentsCapabilities>({
          compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
          pagination: {
            supported: true,
            description: 'offset only',
            styles: { offset: true, page: true, cursor: false },
          },
        }),
    } as unknown as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello?page%5Bafter%5D=cursor-abc'));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.detail).toContain('Cursor pagination');
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for page[before] when backend does not support cursor', async () => {
    const listSpy = vi.fn();
    const repo = {
      listRevisions: listSpy,
      getCapabilities: () =>
        LaikaTask.succeed<DocumentsCapabilities>({
          compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
          pagination: {
            supported: true,
            description: 'offset only',
            styles: { offset: true, page: true, cursor: false },
          },
        }),
    } as unknown as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello?page%5Bbefore%5D=cursor-abc'));
    expect(res.status).toBe(400);
    expect(listSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /revisions/:key — pagination links.next shape (LCMS-279)
// ---------------------------------------------------------------------------

describe('GET /revisions/:key — pagination links.next shape (LCMS-279)', () => {
  it('page[size]=N emits links.next with page[number], not page[after]', async () => {
    const summaries = [makeRevisionSummary('posts/hello', 'rev-1'), makeRevisionSummary('posts/hello', 'rev-2')];
    const repo = {
      listRevisions: (_key: string, _options: unknown) =>
        LaikaStream.make<RevisionSummary, ListRevisionsDone>(emit =>
          Effect.gen(function*() {
            for (const s of summaries) yield* emit.data(s);
            return { total: 10 };
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello?page%5Bsize%5D=2'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[], links: { next?: string } };
    expect(body.data).toHaveLength(2);
    expect(body.links.next).toBeDefined();
    expect(body.links.next).toContain('page[number]');
    expect(body.links.next).not.toContain('page[after]');
  });

  it('page[number]=1&page[size]=N with a full page emits links.next=page[number]=2', async () => {
    const summaries = [makeRevisionSummary('posts/hello', 'rev-1'), makeRevisionSummary('posts/hello', 'rev-2')];
    const repo = {
      listRevisions: (_key: string, _options: unknown) =>
        LaikaStream.make<RevisionSummary, ListRevisionsDone>(emit =>
          Effect.gen(function*() {
            for (const s of summaries) yield* emit.data(s);
            return { total: 10 };
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/revisions/posts%2Fhello?page%5Bnumber%5D=1&page%5Bsize%5D=2'),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { links: { next?: string } };
    const nextUrl = new URL(body.links.next!);
    expect(nextUrl.searchParams.get('page[number]')).toBe('2');
    expect(nextUrl.searchParams.get('page[size]')).toBe('2');
    expect(nextUrl.searchParams.get('page[after]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /revisions/:key/:revisionId (LCMS-188)
// ---------------------------------------------------------------------------

describe('GET /revisions/:key/:revisionId', () => {
  it('returns 200 with revision resource', async () => {
    const rev = makeRevision('posts/hello', 'rev-1');
    const repo = {
      getRevision: (_key: string, _revisionId: string) => LaikaTask.make(() => Effect.succeed(rev)),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello/rev-1'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: { type: string, id: string, attributes: { key: string, revision: string } },
    };
    expect(body.data.type).toBe('revision');
    expect(body.data.id).toBe('posts/hello/rev-1');
    expect(body.data.attributes.key).toBe('posts/hello');
    expect(body.data.attributes.revision).toBe('rev-1');
  });

  it('returns 404 JSON:API error when revision not found', async () => {
    const repo = {
      getRevision: (_key: string, _revisionId: string) =>
        LaikaTask.make(() => Effect.fail(new NotFoundError('revision not found'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello/missing-rev'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
    expect(body.errors[0]!.code).toBe('not_found');
  });

  it('returns 500 JSON:API error when repo throws InternalError on getRevision', async () => {
    const repo = {
      getRevision: (_key: string, _revisionId: string) =>
        LaikaTask.make(() => Effect.fail(new InternalError('storage failure'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/revisions/posts%2Fhello/rev-1'));
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// GET /records — filter param forwarding (LCMS-196)
// ---------------------------------------------------------------------------

describe('GET /records — filter param forwarding', () => {
  const makeListRecordsRepo = (spy: ReturnType<typeof vi.fn>) =>
    ({
      listRecords: spy,
    }) as unknown as DocumentsRepository;

  const makeRecordsStream = (entries: Array<ReturnType<typeof makeDocument> | ReturnType<typeof makeUnpublished>>) =>
    LaikaStream.make<
      {
        type: string,
        key: string,
        status: string,
        language: string,
        content: object,
        createdAt: string,
        updatedAt: string,
      },
      ListRecordsDone
    >(emit =>
      Effect.gen(function*() {
        for (const e of entries) yield* emit.data(e);
        return { total: entries.length };
      })
    );

  it('forwards filter[type]=unpublished to the repo and returns unpublished entries', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) => makeRecordsStream([makeUnpublished('posts/draft')]));
    const api = buildJsonApi({ repo: makeListRecordsRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/records?filter%5Btype%5D=unpublished'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].type).toBe('unpublished');

    const body = await res.json() as { data: Array<{ type: string, id: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.type).toBe('unpublished');
    expect(body.data[0]!.id).toBe('posts/draft');
  });

  it('forwards filter[type]=all as undefined type to the repo', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) =>
      makeRecordsStream([makeDocument('posts/hello'), makeUnpublished('posts/draft')])
    );
    const api = buildJsonApi({ repo: makeListRecordsRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/records?filter%5Btype%5D=all'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].type).toBeUndefined();

    const body = await res.json() as { data: Array<{ type: string }> };
    expect(body.data).toHaveLength(2);
  });

  it('forwards filter[folder]=posts to the repo', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) => makeRecordsStream([makeDocument('posts/hello')]));
    const api = buildJsonApi({ repo: makeListRecordsRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/records?filter%5Bfolder%5D=posts'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].folder).toBe('posts');
  });

  it('parses filter[depth]=2 as a number and forwards it to the repo', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) => makeRecordsStream([]));
    const api = buildJsonApi({ repo: makeListRecordsRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/records?filter%5Bdepth%5D=2'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].depth).toBe(2);
    expect(typeof spy.mock.calls[0]![0].depth).toBe('number');
  });

  it('returns correct JSON:API shape for an unpublished entry in /records', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) => makeRecordsStream([makeUnpublished('posts/draft')]));
    const api = buildJsonApi({ repo: makeListRecordsRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/records?filter%5Btype%5D=unpublished'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: Array<{ type: string, id: string, attributes: { status: string, content: object } }>,
    };
    expect(body.data[0]!.type).toBe('unpublished');
    expect(body.data[0]!.id).toBe('posts/draft');
    expect(body.data[0]!.attributes).toMatchObject({ status: 'draft', content: { title: 'Draft' } });
  });
});

// ---------------------------------------------------------------------------
// GET /records — meta.page.total and pagination forwarding (LCMS-212)
// ---------------------------------------------------------------------------

describe('GET /records — meta.page.total', () => {
  it('surfaces done.total as meta.page.total in the response', async () => {
    const repo = {
      listRecords: (_options: ListRecordsOptions) =>
        LaikaStream.make<
          {
            type: 'published',
            key: string,
            status: string,
            language: string,
            content: object,
            createdAt: string,
            updatedAt: string,
          },
          ListRecordsDone
        >(emit =>
          Effect.gen(function*() {
            yield* emit.data(makeDocument('posts/a'));
            yield* emit.data(makeDocument('posts/b'));
            return { total: 42 };
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/records'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[], meta: { page: { total: number } } };
    expect(body.data).toHaveLength(2);
    expect(body.meta.page.total).toBe(42);
  });

  it('surfaces meta.page.total = 0 when no records exist', async () => {
    const repo = {
      listRecords: (_options: ListRecordsOptions) =>
        LaikaStream.make<never, ListRecordsDone>(_emit => Effect.succeed({ total: 0 })),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/records'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[], meta: { page: { total: number } } };
    expect(body.data).toHaveLength(0);
    expect(body.meta.page.total).toBe(0);
  });

  it('omits meta.page when done.total is undefined', async () => {
    const repo = {
      listRecords: (_options: ListRecordsOptions) =>
        LaikaStream.make<never, ListRecordsDone>(_emit => Effect.succeed({ total: undefined })),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/records'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[], meta?: { page?: unknown } };
    expect(body.data).toHaveLength(0);
    expect(body.meta?.page).toBeUndefined();
  });
});

describe('GET /records — pagination forwarding', () => {
  const makeRepo = (spy: ReturnType<typeof vi.fn>) => ({ listRecords: spy }) as unknown as DocumentsRepository;

  it('forwards page[size] to repo pagination.perPage', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) =>
      LaikaStream.make<
        {
          type: 'published',
          key: string,
          status: string,
          language: string,
          content: object,
          createdAt: string,
          updatedAt: string,
        },
        ListRecordsDone
      >(emit =>
        Effect.gen(function*() {
          yield* emit.data(makeDocument('posts/a'));
          return { total: 1 };
        })
      )
    );
    const api = buildJsonApi({ repo: makeRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/records?page%5Bsize%5D=5'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    const pagination = spy.mock.calls[0]![0].pagination as { perPage?: number };
    expect(pagination.perPage).toBe(5);
  });

  it('forwards page[after] to repo pagination.after when backend supports cursor', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) =>
      LaikaStream.make<never, ListRecordsDone>(_emit => Effect.succeed({ total: 0 }))
    );
    const repo = {
      listRecords: spy,
      getCapabilities: () =>
        LaikaTask.succeed<DocumentsCapabilities>({
          compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
          pagination: {
            supported: true,
            description: 'cursor supported',
            styles: { offset: false, page: false, cursor: true },
          },
        }),
    } as unknown as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/records?page%5Bafter%5D=cursor-abc'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    const pagination = spy.mock.calls[0]![0].pagination as { after?: string };
    expect(pagination.after).toBe('cursor-abc');
  });

  it('returns 400 for page[after] when backend does not support cursor', async () => {
    const listSpy = vi.fn();
    const repo = {
      listRecords: listSpy,
      getCapabilities: () =>
        LaikaTask.succeed<DocumentsCapabilities>({
          compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
          pagination: {
            supported: true,
            description: 'offset only',
            styles: { offset: true, page: true, cursor: false },
          },
        }),
    } as unknown as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/records?page%5Bafter%5D=cursor-abc'));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.detail).toContain('Cursor pagination');
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for page[before] when backend does not support cursor', async () => {
    const repo = {
      listRecords: vi.fn(),
      getCapabilities: () =>
        LaikaTask.succeed<DocumentsCapabilities>({
          compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
          pagination: {
            supported: true,
            description: 'offset only',
            styles: { offset: true, page: true, cursor: false },
          },
        }),
    } as unknown as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/records?page%5Bbefore%5D=cursor-abc'));
    expect(res.status).toBe(400);
  });

  it('page[size] without cursor params is unaffected by capability guard', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) =>
      LaikaStream.make<never, ListRecordsDone>(_emit => Effect.succeed({ total: 0 }))
    );
    const repo = {
      listRecords: spy,
      getCapabilities: () =>
        LaikaTask.succeed<DocumentsCapabilities>({
          compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
          pagination: {
            supported: true,
            description: 'offset only',
            styles: { offset: true, page: true, cursor: false },
          },
        }),
    } as unknown as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/records?page%5Bsize%5D=10'));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// GET /records — pagination links.next shape (LCMS-279)
// ---------------------------------------------------------------------------

describe('GET /records — pagination links.next shape (LCMS-279)', () => {
  const makeRecordsRepo = (docs: Array<ReturnType<typeof makeDocument>>) =>
    ({
      listRecords: (_opts: ListRecordsOptions) =>
        LaikaStream.make<
          {
            type: 'published',
            key: string,
            status: string,
            language: string,
            content: object,
            createdAt: string,
            updatedAt: string,
          },
          ListRecordsDone
        >(emit =>
          Effect.gen(function*() {
            for (const d of docs) yield* emit.data(d);
            return { total: 10 };
          })
        ),
    }) as unknown as DocumentsRepository;

  it('page[size]=N emits links.next with page[number], not page[after] (LCMS-277 guard)', async () => {
    const api = buildJsonApi({
      repo: makeRecordsRepo([makeDocument('posts/a'), makeDocument('posts/b')]),
      authorize: allowAll,
    });
    const res = await api.fetch(new Request('http://localhost/records?page%5Bsize%5D=2'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[], links: { next?: string } };
    expect(body.data).toHaveLength(2);
    expect(body.links.next).toBeDefined();
    expect(body.links.next).toContain('page[number]');
    expect(body.links.next).not.toContain('page[after]');
  });

  it('page[number]=1&page[size]=N with a full page emits links.next=page[number]=2&page[size]=N', async () => {
    const api = buildJsonApi({
      repo: makeRecordsRepo([makeDocument('posts/a'), makeDocument('posts/b')]),
      authorize: allowAll,
    });
    const res = await api.fetch(new Request('http://localhost/records?page%5Bnumber%5D=1&page%5Bsize%5D=2'));
    expect(res.status).toBe(200);

    const body = await res.json() as { links: { next?: string } };
    const nextUrl = new URL(body.links.next!);
    expect(nextUrl.searchParams.get('page[number]')).toBe('2');
    expect(nextUrl.searchParams.get('page[size]')).toBe('2');
    expect(nextUrl.searchParams.get('page[after]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /record-summaries — filter param forwarding (LCMS-196)
// ---------------------------------------------------------------------------

describe('GET /record-summaries — filter param forwarding', () => {
  const makeListSummariesRepo = (spy: ReturnType<typeof vi.fn>) =>
    ({
      listRecordSummaries: spy,
    }) as unknown as DocumentsRepository;

  const makeSummariesStream = (
    entries: Array<
      {
        type: 'published-summary' | 'unpublished-summary',
        key: string,
        status: string,
        language: string,
        createdAt: string,
        updatedAt: string,
      }
    >,
  ) =>
    LaikaStream.make<
      { type: string, key: string, status: string, language: string, createdAt: string, updatedAt: string },
      ListRecordsDone
    >(emit =>
      Effect.gen(function*() {
        for (const e of entries) yield* emit.data(e);
        return { total: entries.length };
      })
    );

  const makeSummary = (type: 'published-summary' | 'unpublished-summary', key: string) => ({
    type,
    key,
    status: type === 'published-summary' ? 'published' : 'draft',
    language: 'en' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  it('forwards filter[type]=unpublished to the repo for /record-summaries', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) =>
      makeSummariesStream([makeSummary('unpublished-summary', 'posts/draft')])
    );
    const api = buildJsonApi({ repo: makeListSummariesRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/record-summaries?filter%5Btype%5D=unpublished'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].type).toBe('unpublished');

    const body = await res.json() as { data: Array<{ type: string, id: string }> };
    expect(body.data[0]!.type).toBe('unpublished-summary');
  });

  it('forwards filter[type]=all as undefined type to the repo for /record-summaries', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) =>
      makeSummariesStream([
        makeSummary('published-summary', 'posts/hello'),
        makeSummary('unpublished-summary', 'posts/draft'),
      ])
    );
    const api = buildJsonApi({ repo: makeListSummariesRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/record-summaries?filter%5Btype%5D=all'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].type).toBeUndefined();

    const body = await res.json() as { data: Array<{ type: string }> };
    expect(body.data).toHaveLength(2);
  });

  it('forwards filter[folder]=posts to the repo for /record-summaries', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) =>
      makeSummariesStream([makeSummary('published-summary', 'posts/hello')])
    );
    const api = buildJsonApi({ repo: makeListSummariesRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/record-summaries?filter%5Bfolder%5D=posts'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].folder).toBe('posts');
  });

  it('parses filter[depth]=2 as a number and forwards it for /record-summaries', async () => {
    const spy = vi.fn((_opts: ListRecordsOptions) => makeSummariesStream([]));
    const api = buildJsonApi({ repo: makeListSummariesRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/record-summaries?filter%5Bdepth%5D=2'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].depth).toBe(2);
    expect(typeof spy.mock.calls[0]![0].depth).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// GET /record-summaries — meta.page.total and pagination forwarding (LCMS-207)
// ---------------------------------------------------------------------------

describe('GET /record-summaries — meta.page.total', () => {
  const makeSummary = (type: 'published-summary' | 'unpublished-summary', key: string) => ({
    type,
    key,
    status: type === 'published-summary' ? 'published' : 'draft',
    language: 'en' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  it('surfaces done.total as meta.page.total in the response', async () => {
    const repo = {
      listRecordSummaries: (_options: ListRecordSummaries) =>
        LaikaStream.make<
          {
            type: 'published-summary',
            key: string,
            status: string,
            language: string,
            createdAt: string,
            updatedAt: string,
          },
          ListRecordsDone
        >(emit =>
          Effect.gen(function*() {
            yield* emit.data(makeSummary('published-summary', 'posts/a'));
            yield* emit.data(makeSummary('published-summary', 'posts/b'));
            return { total: 42 };
          })
        ),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/record-summaries'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[], meta: { page: { total: number } } };
    expect(body.data).toHaveLength(2);
    expect(body.meta.page.total).toBe(42);
  });

  it('surfaces meta.page.total = 0 when no summaries exist', async () => {
    const repo = {
      listRecordSummaries: (_options: ListRecordSummaries) =>
        LaikaStream.make<never, ListRecordsDone>(_emit => Effect.succeed({ total: 0 })),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/record-summaries'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[], meta: { page: { total: number } } };
    expect(body.data).toHaveLength(0);
    expect(body.meta.page.total).toBe(0);
  });
});

describe('GET /record-summaries — pagination forwarding', () => {
  const makeSummary = (key: string) => ({
    type: 'published-summary' as const,
    key,
    status: 'published',
    language: 'en' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  const makeRepo = (spy: ReturnType<typeof vi.fn>) => ({ listRecordSummaries: spy }) as unknown as DocumentsRepository;

  it('forwards page[size] to repo pagination.perPage', async () => {
    const spy = vi.fn((_opts: ListRecordSummaries) =>
      LaikaStream.make<
        {
          type: 'published-summary',
          key: string,
          status: string,
          language: string,
          createdAt: string,
          updatedAt: string,
        },
        ListRecordsDone
      >(emit =>
        Effect.gen(function*() {
          yield* emit.data(makeSummary('posts/a'));
          return { total: 1 };
        })
      )
    );
    const api = buildJsonApi({ repo: makeRepo(spy), authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/record-summaries?page%5Bsize%5D=5'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    const pagination = spy.mock.calls[0]![0].pagination as { perPage?: number };
    expect(pagination.perPage).toBe(5);
  });

  it('forwards page[after] to repo pagination.after when backend supports cursor', async () => {
    const spy = vi.fn((_opts: ListRecordSummaries) =>
      LaikaStream.make<never, ListRecordsDone>(_emit => Effect.succeed({ total: 0 }))
    );
    const repo = {
      listRecordSummaries: spy,
      getCapabilities: () =>
        LaikaTask.succeed<DocumentsCapabilities>({
          compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
          pagination: {
            supported: true,
            description: 'cursor supported',
            styles: { offset: false, page: false, cursor: true },
          },
        }),
    } as unknown as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/record-summaries?page%5Bafter%5D=cursor-abc'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    const pagination = spy.mock.calls[0]![0].pagination as { after?: string };
    expect(pagination.after).toBe('cursor-abc');
  });

  it('returns 400 for page[after] when backend does not support cursor', async () => {
    const listSpy = vi.fn();
    const repo = {
      listRecordSummaries: listSpy,
      getCapabilities: () =>
        LaikaTask.succeed<DocumentsCapabilities>({
          compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
          pagination: {
            supported: true,
            description: 'offset only',
            styles: { offset: true, page: true, cursor: false },
          },
        }),
    } as unknown as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/record-summaries?page%5Bafter%5D=cursor-abc'));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.detail).toContain('Cursor pagination');
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for page[before] when backend does not support cursor', async () => {
    const repo = {
      listRecordSummaries: vi.fn(),
      getCapabilities: () =>
        LaikaTask.succeed<DocumentsCapabilities>({
          compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
          pagination: {
            supported: true,
            description: 'offset only',
            styles: { offset: true, page: true, cursor: false },
          },
        }),
    } as unknown as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/record-summaries?page%5Bbefore%5D=cursor-abc'));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /record-summaries — pagination links.next shape (LCMS-279)
// ---------------------------------------------------------------------------

describe('GET /record-summaries — pagination links.next shape (LCMS-279)', () => {
  const makeSummaryDoc = (key: string) => ({
    type: 'published-summary' as const,
    key,
    status: 'published',
    language: 'en' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  const makeSummariesRepo = (docs: Array<ReturnType<typeof makeSummaryDoc>>) =>
    ({
      listRecordSummaries: (_opts: unknown) =>
        LaikaStream.make<
          {
            type: 'published-summary',
            key: string,
            status: string,
            language: string,
            createdAt: string,
            updatedAt: string,
          },
          ListRecordsDone
        >(emit =>
          Effect.gen(function*() {
            for (const d of docs) yield* emit.data(d);
            return { total: 10 };
          })
        ),
    }) as unknown as DocumentsRepository;

  it('page[size]=N emits links.next with page[number], not page[after] (LCMS-277 guard)', async () => {
    const api = buildJsonApi({
      repo: makeSummariesRepo([makeSummaryDoc('posts/a'), makeSummaryDoc('posts/b')]),
      authorize: allowAll,
    });
    const res = await api.fetch(new Request('http://localhost/record-summaries?page%5Bsize%5D=2'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[], links: { next?: string } };
    expect(body.data).toHaveLength(2);
    expect(body.links.next).toBeDefined();
    expect(body.links.next).toContain('page[number]');
    expect(body.links.next).not.toContain('page[after]');
  });
});

// ---------------------------------------------------------------------------
// POST /operations — atomic operations
// ---------------------------------------------------------------------------

type AtomicResultData = { data: { type: string, id: string, attributes: Record<string, unknown> } };
type AtomicResultMeta = { meta: { deleted: boolean, ref: { type: string, id: string } } };
type AtomicResultError = { errors: Array<{ status: string, title: string, detail?: string }> };
type BatchBody = { results: Array<AtomicResultData | AtomicResultMeta | AtomicResultError> };
type BatchErrorBody = {
  errors: Array<{ status: string, code: string, detail?: string, source?: { pointer: string } }>,
};

const postOperations = (api: ReturnType<typeof buildJsonApi>, operations: unknown[]) =>
  api.fetch(
    new Request('http://localhost/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: JSON.stringify({ operations }),
    }),
  );

describe('POST /operations — add/unpublished', () => {
  it('calls repo.createUnpublished and returns data.type === "unpublished"', async () => {
    const repo = {
      createUnpublished: (_data: unknown) => LaikaTask.make(() => Effect.succeed(makeUnpublished('posts/new-draft'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      {
        op: 'add',
        data: { type: 'unpublished', id: 'posts/new-draft', attributes: { title: 'New draft', status: 'draft' } },
      },
    ]);
    expect(res.status).toBe(200);

    const body = await res.json() as BatchBody;
    expect(body.results).toHaveLength(1);
    const result = body.results[0] as AtomicResultData;
    expect(result.data.type).toBe('unpublished');
    expect(result.data.id).toBe('posts/new-draft');
  });
});

describe('POST /operations — add/published', () => {
  it('calls repo.createDocument and returns data.type === "published"', async () => {
    const repo = {
      createDocument: (_data: unknown) => LaikaTask.make(() => Effect.succeed(makeDocument('posts/hello'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      {
        op: 'add',
        data: { type: 'published', id: 'posts/hello', attributes: { title: 'Hello', status: 'published' } },
      },
    ]);
    expect(res.status).toBe(200);

    const body = await res.json() as BatchBody;
    expect(body.results).toHaveLength(1);
    const result = body.results[0] as AtomicResultData;
    expect(result.data.type).toBe('published');
    expect(result.data.id).toBe('posts/hello');
  });
});

describe('POST /operations — add/unpublished missing data.id', () => {
  it('returns 400 with top-level errors (zero writes) when data.id is absent', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await postOperations(api, [
      { op: 'add', data: { type: 'unpublished', attributes: { title: 'No key', status: 'draft' } } },
    ]);
    expect(res.status).toBe(400);

    const body = await res.json() as BatchErrorBody;
    expect(body.errors).toBeDefined();
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.detail).toContain('operations[0].data.id');
  });

  it('returns 400 and performs zero writes when a mixed batch contains an add/unpublished op without data.id', async () => {
    const createUnpublished = vi.fn();
    const repo = {
      createUnpublished,
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      { op: 'add', data: { type: 'unpublished', id: 'posts/first', attributes: { title: 'Has ID', status: 'draft' } } },
      { op: 'add', data: { type: 'unpublished', attributes: { title: 'No key', status: 'draft' } } },
    ]);
    expect(res.status).toBe(400);
    expect(createUnpublished).not.toHaveBeenCalled();

    const body = await res.json() as BatchErrorBody;
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.detail).toContain('operations[1].data.id');
  });
});

describe('POST /operations — add/published missing data.id', () => {
  it('returns 400 with top-level errors (zero writes) when data.id is absent', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await postOperations(api, [
      { op: 'add', data: { type: 'published', attributes: { title: 'No key', status: 'published' } } },
    ]);
    expect(res.status).toBe(400);

    const body = await res.json() as BatchErrorBody;
    expect(body.errors).toBeDefined();
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.detail).toContain('operations[0].data.id');
  });

  it('returns 400 and performs zero writes when a mixed batch contains an add/published op without data.id', async () => {
    const createDocument = vi.fn();
    const repo = {
      createDocument,
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      {
        op: 'add',
        data: { type: 'published', id: 'posts/first', attributes: { title: 'Has ID', status: 'published' } },
      },
      { op: 'add', data: { type: 'published', attributes: { title: 'No key', status: 'published' } } },
    ]);
    expect(res.status).toBe(400);
    expect(createDocument).not.toHaveBeenCalled();

    const body = await res.json() as BatchErrorBody;
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.detail).toContain('operations[1].data.id');
  });
});

describe('POST /operations — update/publish', () => {
  it('calls repo.publish and returns data.type === "published"', async () => {
    const repo = {
      publish: (_key: string) => LaikaTask.make(() => Effect.succeed(makeDocument('posts/now-live'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      { op: 'update', href: '/publish', ref: { type: 'unpublished', id: 'posts/now-live' } },
    ]);
    expect(res.status).toBe(200);

    const body = await res.json() as BatchBody;
    expect(body.results).toHaveLength(1);
    const result = body.results[0] as AtomicResultData;
    expect(result.data.type).toBe('published');
    expect(result.data.id).toBe('posts/now-live');
  });

  it('returns 400 (zero writes) when ref.type is not "unpublished"', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await postOperations(api, [
      { op: 'update', href: '/publish', ref: { type: 'document', id: 'posts/x' } },
    ]);
    expect(res.status).toBe(400);

    const body = await res.json() as BatchErrorBody;
    expect(body.errors).toBeDefined();
    expect(body.errors[0]!.status).toBe('400');
  });
});

describe('POST /operations — update/unpublish', () => {
  it('calls repo.unpublish and returns data.type === "unpublished"', async () => {
    const repo = {
      unpublish: (_key: string, _status: string) =>
        LaikaTask.make(() => Effect.succeed(makeUnpublished('posts/now-draft'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      {
        op: 'update',
        href: '/unpublish',
        ref: { type: 'document', id: 'posts/now-draft' },
        data: { type: 'unpublished', attributes: { status: 'draft' } },
      },
    ]);
    expect(res.status).toBe(200);

    const body = await res.json() as BatchBody;
    expect(body.results).toHaveLength(1);
    const result = body.results[0] as AtomicResultData;
    expect(result.data.type).toBe('unpublished');
    expect(result.data.id).toBe('posts/now-draft');
  });

  it('returns 400 (zero writes) when data is missing', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await postOperations(api, [
      { op: 'update', href: '/unpublish', ref: { type: 'document', id: 'posts/x' } },
    ]);
    expect(res.status).toBe(400);

    const body = await res.json() as BatchErrorBody;
    expect(body.errors).toBeDefined();
    expect(body.errors[0]!.status).toBe('400');
  });

  it('returns 400 (zero writes) when ref.type is not "document"', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await postOperations(api, [
      {
        op: 'update',
        href: '/unpublish',
        ref: { type: 'unpublished', id: 'posts/x' },
        data: { type: 'unpublished', attributes: { status: 'draft' } },
      },
    ]);
    expect(res.status).toBe(400);

    const body = await res.json() as BatchErrorBody;
    expect(body.errors).toBeDefined();
    expect(body.errors[0]!.status).toBe('400');
  });
});

describe('POST /operations — update/content (updateUnpublished)', () => {
  it('calls repo.updateUnpublished and returns data.type === "unpublished"', async () => {
    const updated = { ...makeUnpublished('posts/draft'), content: { title: 'Updated title' } };
    const repo = {
      updateUnpublished: (_data: unknown) => LaikaTask.make(() => Effect.succeed(updated)),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      {
        op: 'update',
        data: { type: 'unpublished', id: 'posts/draft', attributes: { title: 'Updated title', status: 'draft' } },
      },
    ]);
    expect(res.status).toBe(200);

    const body = await res.json() as BatchBody;
    expect(body.results).toHaveLength(1);
    const result = body.results[0] as AtomicResultData;
    expect(result.data.type).toBe('unpublished');
    expect(result.data.id).toBe('posts/draft');
  });
});

describe('POST /operations — remove/document', () => {
  it('calls repo.deleteDocument and returns meta.deleted true with ref.type "document"', async () => {
    const repo = {
      deleteDocument: (_key: string) => LaikaTask.make<void>(() => Effect.succeed(undefined)),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      { op: 'remove', ref: { type: 'document', id: 'posts/old' } },
    ]);
    expect(res.status).toBe(200);

    const body = await res.json() as BatchBody;
    expect(body.results).toHaveLength(1);
    const result = body.results[0] as AtomicResultMeta;
    expect(result.meta.deleted).toBe(true);
    expect(result.meta.ref.type).toBe('document');
    expect(result.meta.ref.id).toBe('posts/old');
    expect((result as unknown as { data?: unknown }).data).toBeUndefined();
  });
});

describe('POST /operations — remove/unpublished', () => {
  it('calls repo.deleteUnpublished and returns meta.deleted true with ref.type "unpublished"', async () => {
    const repo = {
      deleteUnpublished: (_key: string) => LaikaTask.make<void>(() => Effect.succeed(undefined)),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      { op: 'remove', ref: { type: 'unpublished', id: 'posts/draft' } },
    ]);
    expect(res.status).toBe(200);

    const body = await res.json() as BatchBody;
    expect(body.results).toHaveLength(1);
    const result = body.results[0] as AtomicResultMeta;
    expect(result.meta.deleted).toBe(true);
    expect(result.meta.ref.type).toBe('unpublished');
    expect(result.meta.ref.id).toBe('posts/draft');
    expect((result as unknown as { data?: unknown }).data).toBeUndefined();
  });
});

describe('POST /operations — repo-failure status codes', () => {
  it('returns per-operation status "409" when add/published repo raises EntryAlreadyExistsError', async () => {
    const repo = {
      createDocument: (_data: unknown) =>
        LaikaTask.make(() => Effect.fail(new EntryAlreadyExistsError('posts/existing already exists'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      {
        op: 'add',
        data: { type: 'published', id: 'posts/existing', attributes: { title: 'Dupe', status: 'published' } },
      },
    ]);
    expect(res.status).toBe(200);

    const body = await res.json() as BatchBody;
    const result = body.results[0] as AtomicResultError;
    expect(result.errors).toBeDefined();
    expect(result.errors[0]!.status).toBe('409');
  });

  it('returns per-operation status "404" when remove/document repo raises NotFoundError', async () => {
    const repo = {
      deleteDocument: (_key: string) => LaikaTask.make(() => Effect.fail(new NotFoundError('posts/missing not found'))),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      { op: 'remove', ref: { type: 'document', id: 'posts/missing' } },
    ]);
    expect(res.status).toBe(200);

    const body = await res.json() as BatchBody;
    const result = body.results[0] as AtomicResultError;
    expect(result.errors).toBeDefined();
    expect(result.errors[0]!.status).toBe('404');
  });

  it('stops processing after the first repository failure — subsequent ops are not applied', async () => {
    const deleteDocument = vi.fn(() => LaikaTask.make(() => Effect.fail(new NotFoundError('posts/missing not found'))));
    const createUnpublished = vi.fn();
    const repo = { deleteDocument, createUnpublished } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      { op: 'remove', ref: { type: 'document', id: 'posts/missing' } },
      { op: 'add', data: { type: 'unpublished', id: 'posts/new', attributes: { status: 'draft' } } },
    ]);
    expect(res.status).toBe(200);
    expect(createUnpublished).not.toHaveBeenCalled();

    const body = await res.json() as BatchBody;
    expect(body.results).toHaveLength(1);
    expect((body.results[0] as AtomicResultError).errors[0]!.status).toBe('404');
  });
});

describe('POST /operations — malformed body', () => {
  it('returns 400 when operations key is missing', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ notOperations: [] }),
      }),
    );
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors[0]!.status).toBe('400');
  });

  it('returns 400 when body is not valid JSON', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: 'not-json',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /operations — multi-operation batch', () => {
  it('processes multiple operations in a single request and returns all results', async () => {
    const repo = {
      createUnpublished: (_data: unknown) => LaikaTask.make(() => Effect.succeed(makeUnpublished('posts/batch-draft'))),
      deleteDocument: (_key: string) => LaikaTask.make<void>(() => Effect.succeed(undefined)),
    } as unknown as DocumentsRepository;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await postOperations(api, [
      {
        op: 'add',
        data: { type: 'unpublished', id: 'posts/batch-draft', attributes: { title: 'Batch draft', status: 'draft' } },
      },
      { op: 'remove', ref: { type: 'document', id: 'posts/old' } },
    ]);
    expect(res.status).toBe(200);

    const body = await res.json() as BatchBody;
    expect(body.results).toHaveLength(2);
    const addResult = body.results[0] as AtomicResultData;
    const removeResult = body.results[1] as AtomicResultMeta;
    expect(addResult.data.type).toBe('unpublished');
    expect(removeResult.meta.deleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('404 on unknown routes', () => {
  it('returns 404 JSON:API error shape on unknown path', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/unknown-resource'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, title: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });
});

// ---------------------------------------------------------------------------
// GET /records + /record-summaries — invalid query param error shape (LCMS-335)
// ---------------------------------------------------------------------------

describe('GET /records — invalid query params return invalid_data/400, not internal_error/500', () => {
  it('returns HTTP 400 with code:"invalid_data"/status:"400" for filter[depth]=0', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/records?filter%5Bdepth%5D=0'));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.code).toBe('invalid_data');
    expect(body.errors[0]!.status).toBe('400');
  });

  it('returns HTTP 400 with code:"invalid_data"/status:"400" for filter[type]=invalid', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/records?filter%5Btype%5D=invalid'));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.code).toBe('invalid_data');
    expect(body.errors[0]!.status).toBe('400');
  });
});

describe('GET /record-summaries — invalid query params return invalid_data/400, not internal_error/500', () => {
  it('returns HTTP 400 with code:"invalid_data"/status:"400" for filter[depth]=0', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/record-summaries?filter%5Bdepth%5D=0'));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.code).toBe('invalid_data');
    expect(body.errors[0]!.status).toBe('400');
  });

  it('returns HTTP 400 with code:"invalid_data"/status:"400" for filter[type]=invalid', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/record-summaries?filter%5Btype%5D=invalid'));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.code).toBe('invalid_data');
    expect(body.errors[0]!.status).toBe('400');
  });
});

// ---------------------------------------------------------------------------
// Change signals: GET /sync-token and GET /changes
// ---------------------------------------------------------------------------

describe('documents-api change signals', () => {
  const seed = async (repo: InMemoryDocumentsRepository) => {
    await LaikaTask.runPromise(
      repo.createDocument({
        key: 'posts/hello',
        type: 'published',
        status: 'published',
        content: { title: 'Hello' },
        language: 'en',
      }),
    );
  };

  it('GET /sync-token returns the repository token with a self link', async () => {
    const repo = new InMemoryDocumentsRepository();
    await seed(repo);
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/sync-token'));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { type: string, id: string, attributes: { syncToken: string }, links?: { self?: string } },
    };
    expect(body.data.type).toBe('sync-token');
    expect(body.data.id).toBe('self');
    expect(typeof body.data.attributes.syncToken).toBe('string');
    expect(body.data.links?.self).toBe('/sync-token');
  });

  it('GET /sync-token forwards filter[folder] as the scope', async () => {
    const repo = new InMemoryDocumentsRepository();
    await seed(repo);
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/sync-token?filter%5Bfolder%5D=posts'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string, attributes: { syncToken: string, folder?: string } } };
    expect(body.data.id).toBe('posts');
    expect(body.data.attributes.folder).toBe('posts');
    expect(body.data.attributes.syncToken).toBe(
      await LaikaTask.runPromise(repo.getSyncToken({ folder: 'posts' })) as string,
    );
  });

  it('GET /sync-token maps the base NotImplementedError default to HTTP 501', async () => {
    // A repository that implements none of the change-signal surface: the
    // non-abstract base defaults answer for it.
    const repo = Object.create(
      (await import('laikacms/documents')).DocumentsRepository.prototype,
    ) as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/sync-token'));
    expect(res.status).toBe(501);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.code).toBe('not_implemented');
  });

  it('GET /changes without filter[since] returns 400', async () => {
    const api = buildJsonApi({ repo: new InMemoryDocumentsRepository(), authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/changes'));
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ code: string }> };
    expect(body.errors[0]!.code).toBe('bad_request');
  });

  it('GET /changes returns change summaries and meta.syncToken', async () => {
    const repo = new InMemoryDocumentsRepository();
    const since = await LaikaTask.runPromise(repo.getSyncToken());
    await seed(repo);
    await LaikaTask.runPromise(repo.deleteDocument('posts/hello'));
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(
      new Request(`http://localhost/changes?filter%5Bsince%5D=${encodeURIComponent(since)}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<{ type: string, id: string, attributes: { deleted: boolean, version?: string } }>,
      meta?: { syncToken?: string, page?: { total?: number } },
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ type: 'change-summary', id: 'posts/hello' });
    expect(body.data[0]!.attributes.deleted).toBe(true);
    expect(body.meta?.syncToken).toBe(await LaikaTask.runPromise(repo.getSyncToken()) as string);
    expect(body.meta?.page?.total).toBe(1);
  });

  it('GET /changes maps the base NotImplementedError default to HTTP 501', async () => {
    const repo = Object.create(
      (await import('laikacms/documents')).DocumentsRepository.prototype,
    ) as DocumentsRepository;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(new Request('http://localhost/changes?filter%5Bsince%5D=0'));
    expect(res.status).toBe(501);
    const body = await res.json() as { errors: Array<{ code: string }> };
    expect(body.errors[0]!.code).toBe('not_implemented');
  });
});
