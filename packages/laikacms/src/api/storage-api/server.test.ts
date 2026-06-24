import * as Effect from 'effect/Effect';
import { describe, expect, it, vi } from 'vitest';

import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type {
  Folder,
  FolderCreate,
  ListAtomsDone,
  ListAtomsOptions,
  StorageObject,
  StorageObjectCreate,
  StorageRepository,
} from 'laikacms/storage';

import { buildJsonApi } from './server.js';

// The handler only consults `repo` for non-root endpoints. For Cache-Control
// regression tests we hit the root + a 404, neither of which touch the repo,
// so a placeholder cast is enough.
const stubRepo = {} as StorageRepository;

describe('storage-api Cache-Control', () => {
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

describe('storage-api meta.warnings', () => {
  it('surfaces recoverableErrors from listAtoms into the response meta.warnings', async () => {
    const partialRepo = {
      listAtoms: (_folderKey: string, _options: ListAtomsOptions) =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          emit =>
            Effect.gen(function*() {
              yield* emit.data({
                type: 'folder',
                key: 'visible-subfolder',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              });
              yield* emit.recoverableError(new NotFoundError('hidden-subfolder vanished mid-walk'));
              return { total: 1 };
            }),
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/atoms/root'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: Array<{ type: string, id: string }>,
      meta?: { warnings?: Array<{ code: string, detail: string, status: string }> },
    };

    expect(body.data.map(d => d.id)).toEqual(['visible-subfolder']);
    expect(body.meta?.warnings).toBeDefined();
    expect(body.meta?.warnings).toHaveLength(1);
    expect(body.meta?.warnings?.[0]?.code).toBe('not_found');
    expect(body.meta?.warnings?.[0]?.detail).toContain('hidden-subfolder');
  });

  it('surfaces recoverableErrors from createObject into the single-resource meta.warnings', async () => {
    const partialRepo = {
      createObject: (create: StorageObjectCreate) =>
        LaikaTask.make<StorageObject>(emit =>
          Effect.gen(function*() {
            // Simulate an R2-style readback miss: the impl wrote successfully
            // but the post-write getObject failed, so it falls back to a
            // synthesized resource + a recoverableError.
            yield* emit.recoverableError(
              new NotFoundError('readback failed; synthesized from write input'),
            );
            return {
              type: 'object',
              key: create.key,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              content: create.content ?? {},
              metadata: { extension: 'json' },
            } satisfies StorageObject;
          })
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects/notes%2Fhello', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'object', id: 'notes/hello', attributes: { content: { body: 'hi' } } },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as {
      data: { id: string },
      meta?: { warnings?: Array<{ code: string, detail: string }> },
    };

    expect(body.data.id).toBe('notes/hello');
    expect(body.meta?.warnings).toHaveLength(1);
    expect(body.meta?.warnings?.[0]?.code).toBe('not_found');
    expect(body.meta?.warnings?.[0]?.detail).toContain('readback');
  });

  it('surfaces recoverableErrors from getObject (a read) into the single-resource meta.warnings', async () => {
    // A getObject that emits a warning (e.g. data-parse fallback during read)
    // resolves to a usable StorageObject AND a recoverableError. The API
    // should respond 200 with the object plus meta.warnings — symmetric with
    // the write path.
    const partialRepo = {
      getObject: (key: string) =>
        LaikaTask.make<StorageObject>(emit =>
          Effect.gen(function*() {
            yield* emit.recoverableError(
              new NotFoundError('content schema drift; fell back to raw content'),
            );
            return {
              type: 'object',
              key,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              content: { body: 'raw' },
              metadata: { extension: 'json' },
            } satisfies StorageObject;
          })
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/objects/notes%2Fhello'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: { id: string },
      meta?: { warnings?: Array<{ code: string, detail: string }> },
    };

    expect(body.data.id).toBe('notes/hello');
    expect(body.meta?.warnings).toHaveLength(1);
    expect(body.meta?.warnings?.[0]?.detail).toContain('schema drift');
  });

  it('surfaces per-op recoverableErrors on atomic:results when a single add succeeds with warnings', async () => {
    const partialRepo = {
      createObject: (create: StorageObjectCreate) =>
        LaikaTask.make<StorageObject>(emit =>
          Effect.gen(function*() {
            yield* emit.recoverableError(
              new NotFoundError('readback failed; synthesized from write input'),
            );
            return {
              type: 'object',
              key: create.key,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              content: create.content ?? {},
              metadata: { extension: 'json' },
            } satisfies StorageObject;
          })
        ),
      // The atomic batch also drains removeAtoms; provide a no-op so the
      // shared `removalResult` step doesn't blow up.
      removeAtoms: () =>
        LaikaStream.make<string, { removed: number, skipped: number }>(() =>
          Effect.succeed({ removed: 0, skipped: 0 })
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          'atomic:operations': [
            { op: 'add', data: { type: 'object', id: 'notes/a', attributes: { content: { v: 1 } } } },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      'atomic:results': Array<{
        data?: { id: string },
        meta?: { warnings?: Array<{ code: string, detail: string }> },
      }>,
    };

    expect(body['atomic:results']).toHaveLength(1);
    expect(body['atomic:results'][0]?.data?.id).toBe('notes/a');
    expect(body['atomic:results'][0]?.meta?.warnings).toHaveLength(1);
    expect(body['atomic:results'][0]?.meta?.warnings?.[0]?.detail).toContain('readback');
  });

  it('calls onError when a repo operation fails', async () => {
    const onError = vi.fn();
    const partialRepo = {
      getObject: (_key: string) =>
        LaikaTask.make<StorageObject>(() => Effect.fail(new NotFoundError('object not found'))),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo, onError });
    const res = await api.fetch(new Request('http://localhost/objects/missing-key'));
    expect(res.status).toBe(404);
    expect(onError).toHaveBeenCalledOnce();
    const [calledWith] = onError.mock.calls[0]!;
    expect(calledWith).toBeInstanceOf(NotFoundError);
  });

  it('calls onError when the repo throws an unexpected synchronous error', async () => {
    const onError = vi.fn();
    const partialRepo = {
      getObject: (_key: string) => {
        throw new Error('unexpected synchronous defect');
      },
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo, onError });
    const res = await api.fetch(new Request('http://localhost/objects/boom'));
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
    const [calledWith] = onError.mock.calls[0]!;
    expect(calledWith).toBeInstanceOf(Error);
    expect((calledWith as Error).message).toBe('unexpected synchronous defect');
  });

  it('emits a meta.deleted entry per successful remove in atomic:results', async () => {
    const partialRepo = {
      removeAtoms: (keys: readonly string[]) =>
        LaikaStream.make<string, { removed: number, skipped: number }>(emit =>
          Effect.gen(function*() {
            for (const k of keys) yield* emit.data(k);
            return { removed: keys.length, skipped: 0 };
          })
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          'atomic:operations': [
            { op: 'remove', ref: { type: 'atom', id: 'notes/a' } },
            { op: 'remove', ref: { type: 'atom', id: 'notes/b' } },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      'atomic:results': Array<{
        data?: unknown,
        meta?: { deleted?: boolean, ref?: { type: string, id: string } },
      }>,
    };

    expect(body['atomic:results']).toHaveLength(2);
    expect(body['atomic:results'][0]?.data).toBeUndefined();
    expect(body['atomic:results'][0]?.meta?.deleted).toBe(true);
    expect(body['atomic:results'][0]?.meta?.ref?.id).toBe('notes/a');
    expect(body['atomic:results'][1]?.meta?.ref?.id).toBe('notes/b');
  });
});

describe('POST /atoms (create folder)', () => {
  it('returns 201 with the created folder resource', async () => {
    const partialRepo = {
      createFolder: (create: FolderCreate) =>
        LaikaTask.make<Folder>(() =>
          Effect.succeed({
            type: 'folder' as const,
            key: create.key,
            createdAt: '2024-01-15T10:30:00Z',
            updatedAt: '2024-01-15T10:30:00Z',
          })
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/atoms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'folder', id: 'posts/drafts', attributes: {} },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as {
      data: { type: string, id: string, attributes: { type: string } },
    };

    expect(body.data.type).toBe('folder');
    expect(body.data.id).toBe('posts/drafts');
    expect(body.data.attributes.type).toBe('folder');
  });

  it('returns 400 when the request body fails validation', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/atoms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'object' } }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
