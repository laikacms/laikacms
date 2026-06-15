import * as Effect from 'effect/Effect';
import type { DocumentsRepository, ListRecordsDone, ListRecordsOptions } from 'laikacms/documents';
import { describe, expect, it, vi } from 'vitest';

import { InvalidData, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';

import { buildJsonApi } from './server.js';

const stubRepo = {} as DocumentsRepository;

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
