import * as Effect from 'effect/Effect';
import { describe, expect, it, vi } from 'vitest';

import { BadRequestError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
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

// LCMS-245 regression: a repo.createObject that fails via a typed LaikaError
// (e.g. thrown inside Effect.tryPromise) must surface as a 4xx JSON:API error,
// never hang the request. This verifies that runTaskWithMetadata's try-catch
// correctly captures typed failures even when they originate from Promise
// rejections inside the task.
describe('storage-api LCMS-245 rawSerializer extra-field error propagation', () => {
  it('returns a 400 JSON:API error when createObject fails with a typed BadRequestError', async () => {
    const partialRepo = {
      createObject: (_create: StorageObjectCreate) =>
        LaikaTask.make<StorageObject>(() =>
          Effect.fail(
            new BadRequestError(
              "rawSerializer only persists the 'body' field; fields [title] would be silently dropped.",
            ),
          )
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });

    // Race with a timeout so the test fails fast if we regress to a hang
    const res = await Promise.race([
      api.fetch(
        new Request('http://localhost/objects/notes%2Fhello', {
          method: 'POST',
          headers: { 'Content-Type': 'application/vnd.api+json' },
          body: JSON.stringify({
            data: {
              type: 'object',
              id: 'notes/hello',
              attributes: { content: { body: 'hi', title: 'dropped' } },
            },
          }),
        }),
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('POST /objects hung — LCMS-245 regression')), 3000)
      ),
    ]);

    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string, detail: string }> };
    expect(body.errors).toBeDefined();
    expect(body.errors[0]?.code).toBe('bad_request');
    expect(body.errors[0]?.detail).toContain('title');
  });

  it('returns 201 when createObject succeeds with only body field (no regression)', async () => {
    const partialRepo = {
      createObject: (create: StorageObjectCreate) =>
        LaikaTask.make<StorageObject>(() =>
          Effect.succeed({
            type: 'object' as const,
            key: create.key,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            content: create.content ?? {},
            metadata: { extension: 'raw' },
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
  });
});

describe('POST /objects — unknown attribute key rejection (LCMS-254)', () => {
  it('returns 400 when attributes contains top-level keys instead of a content wrapper', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'object',
            id: 'p/foo',
            attributes: { title: 'Hi', body: 'text' },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ detail: string }> };
    expect(body.errors[0]?.detail).toContain('title');
  });

  it("returns 400 when attributes contains a typo'd content key", async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'object',
            id: 'p/foo',
            attributes: { contnet: { title: 'Hi' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ detail: string }> };
    expect(body.errors[0]?.detail).toContain('contnet');
  });

  it('returns 201 when attributes.content is correctly nested', async () => {
    const partialRepo = {
      createObject: (create: StorageObjectCreate) =>
        LaikaTask.make<StorageObject>(() =>
          Effect.succeed({
            type: 'object' as const,
            key: create.key,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            content: create.content ?? {},
            metadata: { extension: 'json' },
          })
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'object',
            id: 'p/foo',
            attributes: { content: { title: 'Hi', body: 'text' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe('storage-api pagination links (LCMS-170)', () => {
  // Emit exactly perPage items so hasMore=true (items.length === requestedLimit).
  // If the links were built from request.url (which already carries query params),
  // buildPaginationLinks would append ?page[...] a second time, producing ??
  it('GET /atoms with page params returns links.next without double "?"', async () => {
    const page = Array.from({ length: 5 }, (_, i) => ({
      type: 'folder' as const,
      key: `folder-${i}`,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }));
    const partialRepo = {
      listAtoms: (_folderKey: string, _options: ListAtomsOptions) =>
        LaikaStream.make<typeof page[0], ListAtomsDone>(emit =>
          Effect.gen(function*() {
            for (const atom of page) yield* emit.data(atom);
            return { total: 10 };
          })
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/atoms/root?page[number]=1&page[size]=5'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { links?: { next?: string, first?: string } };
    expect(body.links?.next).toBeDefined();
    expect(body.links?.next).not.toContain('??');
    expect(body.links?.first).toBeDefined();
    expect(body.links?.first).not.toContain('??');
  });

  it('GET /atom-summaries with page params returns links without double "?"', async () => {
    const page = Array.from({ length: 5 }, (_, i) => ({
      type: 'folder' as const,
      key: `folder-${i}`,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }));
    const partialRepo = {
      listAtomSummaries: (_folderKey: string, _options: ListAtomsOptions) =>
        LaikaStream.make<typeof page[0], ListAtomsDone>(emit =>
          Effect.gen(function*() {
            for (const s of page) yield* emit.data(s);
            return { total: 10 };
          })
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/atom-summaries/root?page[number]=1&page[size]=5'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { links?: { next?: string } };
    expect(body.links?.next).toBeDefined();
    expect(body.links?.next).not.toContain('??');
  });
});

describe('PATCH /objects — unknown attribute key rejection (LCMS-254)', () => {
  it('returns 400 when attributes contains top-level keys instead of a content wrapper', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects/p%2Ffoo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'object',
            id: 'p/foo',
            attributes: { title: 'Hi', body: 'text' },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ detail: string }> };
    expect(body.errors[0]?.detail).toContain('title');
  });
});
