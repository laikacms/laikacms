import * as Effect from 'effect/Effect';
import { describe, expect, it, vi } from 'vitest';

import { BadRequestError, InternalError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type {
  Capabilities,
  Folder,
  FolderCreate,
  ListAtomsDone,
  ListAtomsOptions,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageRepository,
} from 'laikacms/storage';
import { CompatibilityDate } from 'laikacms/storage';

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

  // LCMS-453: a failing individual op in a batch must be omitted from atomic:results;
  // the response is HTTP 200 with a shorter result array (not a per-entry error entry).
  it('omits a failed add op from atomic:results while keeping the successful op (LCMS-453)', async () => {
    const partialRepo = {
      createObject: (create: StorageObjectCreate) => {
        if (create.key === 'notes/bad') {
          return LaikaTask.make<StorageObject>(() => Effect.fail(new InternalError('simulated write failure')));
        }
        return LaikaTask.make<StorageObject>(() =>
          Effect.succeed(
            {
              type: 'object' as const,
              key: create.key,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              content: create.content ?? {},
              metadata: { extension: 'json' },
            } satisfies StorageObject,
          )
        );
      },
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
            { op: 'add', data: { type: 'object', id: 'notes/bad', attributes: { content: { v: 1 } } } },
            { op: 'add', data: { type: 'object', id: 'notes/ok', attributes: { content: { v: 2 } } } },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      'atomic:results': Array<{ data?: { id: string }, meta?: unknown }>,
    };

    // failed op is omitted; only the successful op appears
    expect(body['atomic:results']).toHaveLength(1);
    expect(body['atomic:results'][0]?.data?.id).toBe('notes/ok');
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
      data: { type: string, id: string, attributes: Record<string, unknown> },
    };

    expect(body.data.type).toBe('folder');
    expect(body.data.id).toBe('posts/drafts');
    // `type` must not appear in attributes per JSON:API §7.2.2
    expect('type' in body.data.attributes).toBe(false);
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

describe('POST /objects — empty id validation (LCMS-173)', () => {
  it('returns 400 with a clear id-required message when data.id is empty string', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'object', id: '', attributes: { content: { body: 'x' } } },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ code: string, detail: string }> };
    expect(body.errors[0]?.code).toBe('invalid_data');
    expect(body.errors[0]?.detail).toContain('data.id is required');
  });
});

describe('POST /atoms (create folder) — empty id validation (LCMS-173)', () => {
  it('returns 400 with a clear id-required message when data.id is empty string', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/atoms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'folder', id: '', attributes: {} },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ code: string, detail: string }> };
    expect(body.errors[0]?.code).toBe('invalid_data');
    expect(body.errors[0]?.detail).toContain('data.id is required');
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

// ---------------------------------------------------------------------------
// GET /capabilities (LCMS-178)
// ---------------------------------------------------------------------------

const makeStorageCapabilities = (cursorSupported = false): Capabilities => ({
  compatibilityDate: CompatibilityDate.make('2026-01-01'),
  fileExtensions: { supported: false, description: 'No file extensions' },
  pagination: {
    supported: true,
    description: 'Offset/page based',
    styles: { offset: true, page: true, cursor: cursorSupported },
  },
});

describe('GET /capabilities (LCMS-178)', () => {
  it('returns 200 with storage-capabilities resource', async () => {
    const caps = makeStorageCapabilities();
    const repo = {
      getCapabilities: () => LaikaTask.make(() => Effect.succeed(caps)),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/capabilities'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: { type: string, id: string, attributes: Capabilities },
    };
    expect(body.data.type).toBe('storage-capabilities');
    expect(body.data.id).toBe('self');
    expect(body.data.attributes.compatibilityDate).toBe('2026-01-01');
    expect(body.data.attributes.pagination.supported).toBe(true);
  });

  it('returns JSON:API error shape (404) when repo.getCapabilities() fails', async () => {
    const repo = {
      getCapabilities: () => LaikaTask.make(() => Effect.fail(new NotFoundError('unavailable'))),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/capabilities'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });

  it('returns 500 JSON:API error when repo.getCapabilities raises InternalError (LCMS-427)', async () => {
    const repo = {
      getCapabilities: () => LaikaTask.make<Capabilities>(() => Effect.fail(new InternalError('storage outage'))),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/capabilities'));
    expect(res.status).toBe(500);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('500');
    expect(body.errors[0]?.code).toBe('internal_error');
  });
});

// ---------------------------------------------------------------------------
// Cursor pagination rejection (LCMS-172)
// ---------------------------------------------------------------------------

describe('GET /atoms — cursor pagination rejection (LCMS-172)', () => {
  const makeCursorAwareRepo = (cursorSupported: boolean) =>
    ({
      getCapabilities: () => LaikaTask.make(() => Effect.succeed(makeStorageCapabilities(cursorSupported))),
      listAtoms: () =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          emit =>
            Effect.gen(function*() {
              yield* emit.data({
                type: 'folder',
                key: 'a',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              });
              return {};
            }),
        ),
      listAtomSummaries: () =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          emit =>
            Effect.gen(function*() {
              yield* emit.data({
                type: 'folder',
                key: 'a',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              });
              return {};
            }),
        ),
    }) as unknown as StorageRepository;

  it('GET /atoms rejects page[after] with 400 when backend has cursor: false', async () => {
    const api = buildJsonApi({ repo: makeCursorAwareRepo(false) });
    const res = await api.fetch(new Request('http://localhost/atoms/posts?page[after]=e04&page[size]=5'));
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ detail: string }> };
    expect(body.errors[0]!.detail).toContain('page[after]');
    expect(body.errors[0]!.detail).toContain('not supported');
  });

  it('GET /atoms rejects page[before] with 400 when backend has cursor: false', async () => {
    const api = buildJsonApi({ repo: makeCursorAwareRepo(false) });
    const res = await api.fetch(new Request('http://localhost/atoms/posts?page[before]=e10'));
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ detail: string }> };
    expect(body.errors[0]!.detail).toContain('page[before]');
    expect(body.errors[0]!.detail).toContain('not supported');
  });

  it('GET /atoms allows page[after] when backend has cursor: true', async () => {
    const api = buildJsonApi({ repo: makeCursorAwareRepo(true) });
    const res = await api.fetch(new Request('http://localhost/atoms/posts?page[after]=e04'));
    expect(res.status).toBe(200);
  });

  it('GET /atom-summaries rejects page[after] with 400 when backend has cursor: false', async () => {
    const api = buildJsonApi({ repo: makeCursorAwareRepo(false) });
    const res = await api.fetch(new Request('http://localhost/atom-summaries/posts?page[after]=e04&page[size]=5'));
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ detail: string }> };
    expect(body.errors[0]!.detail).toContain('page[after]');
    expect(body.errors[0]!.detail).toContain('not supported');
  });

  it('GET /atom-summaries allows page[after] when backend has cursor: true', async () => {
    const api = buildJsonApi({ repo: makeCursorAwareRepo(true) });
    const res = await api.fetch(new Request('http://localhost/atom-summaries/posts?page[after]=e04'));
    expect(res.status).toBe(200);
  });
});

// Standalone page[size] self-reject regression (LCMS-277)
// ---------------------------------------------------------------------------

describe('GET /atoms — standalone page[size] emits followable next link (LCMS-277)', () => {
  // A cursor:false backend (FS/R2) that returns exactly 1 item per call with
  // done.total=2. This gives respondCollectionWithConverter enough info to set
  // hasMore=true: items.length(1) === requestedLimit(1) AND done.total is known.
  const makeTwoItemRepo = () =>
    ({
      getCapabilities: () => LaikaTask.make(() => Effect.succeed(makeStorageCapabilities(false))),
      listAtoms: () =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          emit =>
            Effect.gen(function*() {
              yield* emit.data({
                type: 'folder',
                key: 'posts/drafts',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              });
              return { total: 2 };
            }),
        ),
      listAtomSummaries: () =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          emit =>
            Effect.gen(function*() {
              yield* emit.data({
                type: 'folder',
                key: 'posts/drafts',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              });
              return { total: 2 };
            }),
        ),
    }) as unknown as StorageRepository;

  it('GET /atoms?page[size]=1 emits a page[number]-based next link, not page[after]', async () => {
    const api = buildJsonApi({ repo: makeTwoItemRepo() });
    const res = await api.fetch(new Request('http://localhost/atoms/posts?page[size]=1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { links?: { next?: string } };
    expect(body.links?.next).toBeDefined();
    expect(body.links?.next).toContain('page[number]');
    expect(body.links?.next).not.toContain('page[after]');
  });

  it('following the next link from GET /atoms?page[size]=1 returns 200, not 400', async () => {
    const api = buildJsonApi({ repo: makeTwoItemRepo() });
    // Get page 1 to obtain the next link
    const res1 = await api.fetch(new Request('http://localhost/atoms/posts?page[size]=1'));
    const body1 = await res1.json() as { links?: { next?: string } };
    const nextUrl = body1.links?.next;
    expect(nextUrl).toBeDefined();
    // Follow the next link — must not be rejected with 400
    const res2 = await api.fetch(new Request(nextUrl!));
    expect(res2.status).toBe(200);
  });

  it('GET /atom-summaries?page[size]=1 emits a page[number]-based next link, not page[after]', async () => {
    const api = buildJsonApi({ repo: makeTwoItemRepo() });
    const res = await api.fetch(new Request('http://localhost/atom-summaries/posts?page[size]=1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { links?: { next?: string } };
    expect(body.links?.next).toBeDefined();
    expect(body.links?.next).toContain('page[number]');
    expect(body.links?.next).not.toContain('page[after]');
  });
});

// ---------------------------------------------------------------------------
// DELETE /objects/:key (LCMS-205)
// ---------------------------------------------------------------------------

describe('DELETE /objects/:key', () => {
  const makeDeleteRepo = (keysThatExist: string[]) =>
    ({
      removeAtoms: (keys: readonly string[]) =>
        LaikaStream.make<string, { removed: number, skipped: number }>(emit =>
          Effect.gen(function*() {
            let removed = 0;
            for (const k of keys) {
              if (keysThatExist.includes(k)) {
                yield* emit.data(k);
                removed++;
              }
            }
            return { removed, skipped: keys.length - removed };
          })
        ),
    }) as unknown as StorageRepository;

  it('returns 200 with meta.deleted=true when the key exists', async () => {
    const api = buildJsonApi({ repo: makeDeleteRepo(['hello.md']) });
    const res = await api.fetch(
      new Request('http://localhost/objects/hello.md', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { meta: { deleted: boolean } };
    expect(body.meta.deleted).toBe(true);
  });

  it('returns 404 when the key does not exist', async () => {
    const api = buildJsonApi({ repo: makeDeleteRepo([]) });
    const res = await api.fetch(
      new Request('http://localhost/objects/missing.md', { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { errors: Array<{ code: string }> };
    expect(body.errors[0]!.code).toBe('not_found');
  });

  it('decodes %2F-encoded keys before passing to removeAtoms', async () => {
    const api = buildJsonApi({ repo: makeDeleteRepo(['posts/hello-world.md']) });
    const res = await api.fetch(
      new Request('http://localhost/objects/posts%2Fhello-world.md', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { meta: { deleted: boolean } };
    expect(body.meta.deleted).toBe(true);
  });

  it('surfaces recoverableErrors from removeAtoms as meta.warnings', async () => {
    const partialRepo = {
      removeAtoms: (keys: readonly string[]) =>
        LaikaStream.make<string, { removed: number, skipped: number }>(emit =>
          Effect.gen(function*() {
            for (const k of keys) yield* emit.data(k);
            yield* emit.recoverableError(new NotFoundError('side-effect removal warning'));
            return { removed: keys.length, skipped: 0 };
          })
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects/hello.md', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      meta: { deleted: boolean, warnings?: Array<{ code: string }> },
    };
    expect(body.meta.deleted).toBe(true);
    expect(body.meta.warnings).toHaveLength(1);
    expect(body.meta.warnings?.[0]?.code).toBe('not_found');
  });

  it('returns 400 when no key is provided (DELETE /objects)', async () => {
    const api = buildJsonApi({ repo: makeDeleteRepo([]) });
    const res = await api.fetch(
      new Request('http://localhost/objects', { method: 'DELETE' }),
    );
    expect(res.status).toBe(400);
  });

  // Regression test for LCMS-216: FS repo resolves extension-less keys to their
  // on-disk path with extension (e.g. "del-test" → "del-test.md"), so the emitted
  // data item never equals the raw input key. The handler must use done.removed,
  // not data.includes(key), to detect success.
  it('returns 200 when removeAtoms emits the extension-resolved path rather than the raw key (LCMS-216)', async () => {
    const extensionResolvingRepo = {
      removeAtoms: (keys: readonly string[]) =>
        LaikaStream.make<string, { removed: number, skipped: number }>(emit =>
          Effect.gen(function*() {
            // Mirror what the FS backend does: emit the resolved on-disk path with extension,
            // not the original extension-less key supplied by the caller.
            for (const k of keys) yield* emit.data(`${k}.md`);
            return { removed: keys.length, skipped: 0 };
          })
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: extensionResolvingRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects/del-test', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { meta: { deleted: boolean } };
    expect(body.meta.deleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 405 Method Not Allowed for unsupported verbs on /objects/{key} (LCMS-205)
// ---------------------------------------------------------------------------

describe('405 Method Not Allowed on /objects/{key}', () => {
  it('returns 405 with Allow header for PUT on /objects/{key}', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects/hello.md', { method: 'PUT' }),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, PATCH, DELETE');
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]!.status).toBe('405');
    expect(body.errors[0]!.code).toBe('method_not_allowed');
  });

  it('sends Cache-Control: no-store on 405 responses', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects/hello.md', { method: 'PUT' }),
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

// ---------------------------------------------------------------------------
// PATCH /objects/:key (LCMS-218)
// ---------------------------------------------------------------------------

const makeUpdateObjectRepo = (resultKey: string) =>
  ({
    updateObject: (update: StorageObjectUpdate) =>
      LaikaTask.make<StorageObject>(() =>
        Effect.succeed(
          {
            type: 'object',
            key: resultKey,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-06-01T00:00:00Z',
            content: update.content ?? {},
            metadata: { extension: 'json' },
          } satisfies StorageObject,
        )
      ),
  }) as unknown as StorageRepository;

describe('PATCH /objects/:key (LCMS-218)', () => {
  it('returns 200 with updated object resource on valid matching body', async () => {
    const api = buildJsonApi({ repo: makeUpdateObjectRepo('posts/hello') });
    const res = await api.fetch(
      new Request('http://localhost/objects/posts%2Fhello', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'object',
            id: 'posts/hello',
            attributes: { content: { title: 'Updated Title' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { type: string, id: string, attributes: { content: Record<string, unknown> } },
    };
    expect(body.data.type).toBe('object');
    expect(body.data.id).toBe('posts/hello');
    expect(body.data.attributes.content).toEqual({ title: 'Updated Title' });
  });

  it('returns 400 when URL key does not match body data.id', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects/posts%2Fhello', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'object',
            id: 'posts/different',
            attributes: { content: { title: 'Mismatch' } },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ detail: string }> };
    expect(body.errors[0]!.detail).toContain('URL');
  });

  it('returns 404 when repo.updateObject fails with NotFoundError', async () => {
    const notFoundRepo = {
      updateObject: () => LaikaTask.make<StorageObject>(() => Effect.fail(new NotFoundError('not found'))),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: notFoundRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects/posts%2Fmissing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'object',
            id: 'posts/missing',
            attributes: { content: {} },
          },
        }),
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { errors: Array<{ code: string }> };
    expect(body.errors[0]!.code).toBe('not_found');
  });

  it('returns 500 JSON:API error when repo.updateObject raises InternalError (LCMS-427)', async () => {
    const repo = {
      updateObject: () => LaikaTask.make<StorageObject>(() => Effect.fail(new InternalError('storage outage'))),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/objects/posts%2Fhello', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'object', id: 'posts/hello', attributes: { content: {} } },
        }),
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('500');
    expect(body.errors[0]?.code).toBe('internal_error');
  });
});

// ---------------------------------------------------------------------------
// GET /folders/:key (LCMS-218)
// ---------------------------------------------------------------------------

const makeFolderRepo = (existingKeys: string[]) =>
  ({
    getFolder: (key: string) =>
      LaikaTask.make<Folder>(() =>
        existingKeys.includes(key)
          ? Effect.succeed(
            {
              type: 'folder',
              key,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            } satisfies Folder,
          )
          : Effect.fail(new NotFoundError(`Folder not found: ${key}`))
      ),
  }) as unknown as StorageRepository;

// ---------------------------------------------------------------------------
// GET /atoms and GET /atom-summaries — meta.page.total surfacing (LCMS-214)
// ---------------------------------------------------------------------------

describe('storage-api meta.page.total (LCMS-214)', () => {
  it('GET /atoms/:key includes meta.page.total when stream done has total', async () => {
    const partialRepo = {
      listAtoms: (_folderKey: string, _options: ListAtomsOptions) =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          emit =>
            Effect.gen(function*() {
              yield* emit.data({
                type: 'folder',
                key: 'posts',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              });
              return { total: 42 };
            }),
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/atoms/root'));
    expect(res.status).toBe(200);
    const body = await res.json() as { meta?: { page?: { total?: number } } };
    expect(body.meta?.page?.total).toBe(42);
  });

  it('GET /atoms/:key omits meta.page when stream done has no total', async () => {
    const partialRepo = {
      listAtoms: (_folderKey: string, _options: ListAtomsOptions) =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          emit =>
            Effect.gen(function*() {
              yield* emit.data({
                type: 'folder',
                key: 'posts',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              });
              return {} as ListAtomsDone;
            }),
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/atoms/root'));
    expect(res.status).toBe(200);
    const body = await res.json() as { meta?: { page?: { total?: number } } };
    expect(body.meta?.page).toBeUndefined();
  });

  it('GET /atom-summaries/:key includes meta.page.total when stream done has total', async () => {
    const partialRepo = {
      listAtomSummaries: (_folderKey: string, _options: ListAtomsOptions) =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          emit =>
            Effect.gen(function*() {
              yield* emit.data({
                type: 'folder',
                key: 'posts',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              });
              return { total: 7 };
            }),
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/atom-summaries/root'));
    expect(res.status).toBe(200);
    const body = await res.json() as { meta?: { page?: { total?: number } } };
    expect(body.meta?.page?.total).toBe(7);
  });

  it('GET /atom-summaries/:key omits meta.page when stream done has no total', async () => {
    const partialRepo = {
      listAtomSummaries: (_folderKey: string, _options: ListAtomsOptions) =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          emit =>
            Effect.gen(function*() {
              yield* emit.data({
                type: 'folder',
                key: 'posts',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              });
              return {} as ListAtomsDone;
            }),
        ),
    } as unknown as StorageRepository;

    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/atom-summaries/root'));
    expect(res.status).toBe(200);
    const body = await res.json() as { meta?: { page?: { total?: number } } };
    expect(body.meta?.page).toBeUndefined();
  });
});

describe('GET /folders/:key (LCMS-218)', () => {
  it('returns 200 with folder resource for an existing folder key', async () => {
    const api = buildJsonApi({ repo: makeFolderRepo(['posts']) });
    const res = await api.fetch(new Request('http://localhost/folders/posts'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('folder');
    expect(body.data.id).toBe('posts');
  });

  it('decodes %2F-encoded folder keys', async () => {
    const api = buildJsonApi({ repo: makeFolderRepo(['posts/2026']) });
    const res = await api.fetch(new Request('http://localhost/folders/posts%2F2026'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe('posts/2026');
  });

  it('returns 404 when repo.getFolder fails with NotFoundError', async () => {
    const api = buildJsonApi({ repo: makeFolderRepo([]) });
    const res = await api.fetch(new Request('http://localhost/folders/missing'));
    expect(res.status).toBe(404);
    const body = await res.json() as { errors: Array<{ code: string }> };
    expect(body.errors[0]!.code).toBe('not_found');
  });

  it('returns 400 when no key segment is provided (GET /folders)', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/folders'));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /atoms/:key — filter[depth] forwarding (LCMS-290)
// ---------------------------------------------------------------------------

describe('GET /atoms/:key — filter[depth] forwarding (LCMS-290)', () => {
  const makeAtomsStream = () =>
    LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
      () => Effect.succeed({} as ListAtomsDone),
    );

  it('parses filter[depth]=2 as a number and forwards it to repo.listAtoms', async () => {
    const spy = vi.fn((_folderKey: string, _options: ListAtomsOptions) => makeAtomsStream());
    const partialRepo = { listAtoms: spy } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });

    const res = await api.fetch(new Request('http://localhost/atoms/root?filter%5Bdepth%5D=2'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![1].depth).toBe(2);
    expect(typeof spy.mock.calls[0]![1].depth).toBe('number');
  });

  it('falls back to depth:1 when filter[depth]=abc is not a valid integer', async () => {
    const spy = vi.fn((_folderKey: string, _options: ListAtomsOptions) => makeAtomsStream());
    const partialRepo = { listAtoms: spy } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });

    const res = await api.fetch(new Request('http://localhost/atoms/root?filter%5Bdepth%5D=abc'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![1].depth).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /atom-summaries/:key — filter[depth] forwarding (LCMS-290)
// ---------------------------------------------------------------------------

describe('GET /atom-summaries/:key — filter[depth] forwarding (LCMS-290)', () => {
  const makeAtomSummariesStream = () =>
    LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
      () => Effect.succeed({} as ListAtomsDone),
    );

  it('parses filter[depth]=2 as a number and forwards it to repo.listAtomSummaries', async () => {
    const spy = vi.fn((_folderKey: string, _options: ListAtomsOptions) => makeAtomSummariesStream());
    const partialRepo = { listAtomSummaries: spy } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });

    const res = await api.fetch(new Request('http://localhost/atom-summaries/root?filter%5Bdepth%5D=2'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![1].depth).toBe(2);
    expect(typeof spy.mock.calls[0]![1].depth).toBe('number');
  });

  it('falls back to depth:1 when filter[depth]=abc is not a valid integer', async () => {
    const spy = vi.fn((_folderKey: string, _options: ListAtomsOptions) => makeAtomSummariesStream());
    const partialRepo = { listAtomSummaries: spy } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });

    const res = await api.fetch(new Request('http://localhost/atom-summaries/root?filter%5Bdepth%5D=abc'));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![1].depth).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /atoms and GET /atom-summaries — filter[prefix] rejection (LCMS-322)
// ---------------------------------------------------------------------------

describe('GET /atoms — filter[prefix] query param rejection (LCMS-322)', () => {
  it('returns 400 with invalid_data when filter[prefix] is used without a path key', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/atoms?filter%5Bprefix%5D=posts'));
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ code: string, detail: string }> };
    expect(body.errors[0]?.code).toBe('invalid_data');
    expect(body.errors[0]?.detail).toContain('filter[prefix]');
    expect(body.errors[0]?.detail).toContain('/atoms/{key}');
  });

  it('does NOT reject when a path key is present alongside filter[prefix]', async () => {
    const partialRepo = {
      listAtoms: (_key: string, _opts: ListAtomsOptions) =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          () => Effect.succeed({} as ListAtomsDone),
        ),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });
    // /atoms/posts has a path key ("posts"), filter[prefix] in query should not trigger 400
    const res = await api.fetch(new Request('http://localhost/atoms/posts?filter%5Bprefix%5D=ignored'));
    expect(res.status).toBe(200);
  });
});

describe('GET /atom-summaries — filter[prefix] query param rejection (LCMS-322)', () => {
  it('returns 400 with invalid_data when filter[prefix] is used without a path key', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/atom-summaries?filter%5Bprefix%5D=posts'));
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ code: string, detail: string }> };
    expect(body.errors[0]?.code).toBe('invalid_data');
    expect(body.errors[0]?.detail).toContain('filter[prefix]');
    expect(body.errors[0]?.detail).toContain('/atom-summaries/{key}');
  });

  it('does NOT reject when a path key is present alongside filter[prefix]', async () => {
    const partialRepo = {
      listAtomSummaries: (_key: string, _opts: ListAtomsOptions) =>
        LaikaStream.make<{ type: 'folder', key: string, createdAt: string, updatedAt: string }, ListAtomsDone>(
          () => Effect.succeed({} as ListAtomsDone),
        ),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/atom-summaries/posts?filter%5Bprefix%5D=ignored'));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// InternalError → 500 path coverage for seven handlers (LCMS-432)
// ---------------------------------------------------------------------------

describe('storage-api: InternalError → 500 coverage (LCMS-432)', () => {
  it('returns 500 JSON:API error when createFolder raises InternalError', async () => {
    const partialRepo = {
      createFolder: () => LaikaTask.make<Folder>(() => Effect.fail(new InternalError('storage outage'))),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/atoms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'folder', id: 'posts/drafts', attributes: {} } }),
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('500');
    expect(body.errors[0]?.code).toBe('internal_error');
  });

  it('returns 500 JSON:API error when getObject raises InternalError', async () => {
    const partialRepo = {
      getObject: () => LaikaTask.make<StorageObject>(() => Effect.fail(new InternalError('storage outage'))),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/objects/notes%2Fhello'));
    expect(res.status).toBe(500);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('500');
    expect(body.errors[0]?.code).toBe('internal_error');
  });

  it('returns 500 JSON:API error when getFolder raises InternalError', async () => {
    const partialRepo = {
      getFolder: () => LaikaTask.make<Folder>(() => Effect.fail(new InternalError('storage outage'))),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/folders/posts'));
    expect(res.status).toBe(500);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('500');
    expect(body.errors[0]?.code).toBe('internal_error');
  });

  it('returns 500 JSON:API error when createObject raises InternalError', async () => {
    const partialRepo = {
      createObject: () => LaikaTask.make<StorageObject>(() => Effect.fail(new InternalError('storage outage'))),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'object', id: 'p/doc', attributes: { content: {} } } }),
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('500');
    expect(body.errors[0]?.code).toBe('internal_error');
  });

  it('returns 500 JSON:API error when listAtoms raises InternalError', async () => {
    const partialRepo = {
      listAtoms: () => LaikaStream.make<never, ListAtomsDone>(() => Effect.fail(new InternalError('storage outage'))),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/atoms/root'));
    expect(res.status).toBe(500);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('500');
    expect(body.errors[0]?.code).toBe('internal_error');
  });

  it('returns 500 JSON:API error when listAtomSummaries raises InternalError', async () => {
    const partialRepo = {
      listAtomSummaries: () =>
        LaikaStream.make<never, ListAtomsDone>(() => Effect.fail(new InternalError('storage outage'))),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(new Request('http://localhost/atom-summaries/root'));
    expect(res.status).toBe(500);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('500');
    expect(body.errors[0]?.code).toBe('internal_error');
  });

  it('returns 500 JSON:API error when removeAtoms raises InternalError', async () => {
    const partialRepo = {
      removeAtoms: () =>
        LaikaStream.make<string, { removed: number, skipped: number }>(
          () => Effect.fail(new InternalError('storage outage')),
        ),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects/notes%2Fhello', { method: 'DELETE' }),
    );
    expect(res.status).toBe(500);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('500');
    expect(body.errors[0]?.code).toBe('internal_error');
  });
});

describe('storage-api: unmapped error code falls back to 500, not 400 (LCMS-434)', () => {
  it('returns 500 when createObject fails with an error code not in ErrorCodeToStatusMap', async () => {
    // Simulate a future errorCode that has no entry in ErrorCodeToStatusMap yet.
    // Before LCMS-434 this would have returned 400; after the fix it must return 500.
    const unmappedErr = Object.assign(new InternalError('storage outage'), { code: 'synthetic_unmapped_code' });
    const partialRepo = {
      createObject: () => LaikaTask.make(() => Effect.fail(unmappedErr)),
    } as unknown as StorageRepository;
    const api = buildJsonApi({ repo: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'object', id: 'p/doc', attributes: { content: {} } } }),
      }),
    );
    expect(res.status).toBe(500);
  });
});
