import * as Effect from 'effect/Effect';
import type {
  Asset,
  AssetsRepository,
  Folder,
  ListResourcesDone,
  ListResourcesOptions,
  Resource,
} from 'laikacms/assets';
import { describe, expect, it } from 'vitest';

import { ForbiddenError, InvalidData, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';

import { buildAssetsApi } from './server.js';

const stubRepo = {} as AssetsRepository;

describe('assets-api Cache-Control', () => {
  it('sends Cache-Control: no-store on 404 responses', async () => {
    const api = buildAssetsApi({ repository: stubRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/does-not-exist'));
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('assets-api meta.warnings', () => {
  it('surfaces recoverableErrors from listResources into the response meta.warnings', async () => {
    const partialRepo = {
      listResources: (_folderKey: string, _options: ListResourcesOptions) =>
        LaikaStream.make<Resource, ListResourcesDone>(emit =>
          Effect.gen(function*() {
            yield* emit.data({
              type: 'folder',
              key: 'visible',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            });
            yield* emit.recoverableError(new ForbiddenError('forbidden/: permission denied'));
            return { total: 1 };
          })
        ),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: Array<{ id: string }>,
      meta?: { warnings?: Array<{ code: string, detail: string }> },
    };

    expect(body.data.map(d => d.id)).toEqual(['visible']);
    expect(body.meta?.warnings).toHaveLength(1);
    expect(body.meta?.warnings?.[0]?.code).toBe('forbidden');
    expect(body.meta?.warnings?.[0]?.detail).toContain('forbidden/');
  });

  it('returns 200 + meta.warnings on a delete that emits a recoverable warning', async () => {
    const partialRepo = {
      // First the route does a lookup to determine type.
      getResource: (key: string) =>
        LaikaTask.make<ReadonlyArray<Resource>>(() =>
          Effect.succeed([{
            type: 'asset' as const,
            key,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            content: { size: 4, etag: 'e' } as Resource['content'],
          }])
        ),
      deleteAsset: (_key: string) =>
        LaikaTask.make<void>(emit =>
          Effect.gen(function*() {
            yield* emit.recoverableError(new InvalidData('orphan thumbnail left behind'));
            return undefined;
          })
        ),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/pic.png', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      meta: { deleted: boolean, warnings?: Array<{ code: string, detail: string }> },
    };

    expect(body.meta.deleted).toBe(true);
    expect(body.meta.warnings).toHaveLength(1);
    expect(body.meta.warnings?.[0]?.detail).toContain('orphan thumbnail');
  });

  it('multi-page cursor walk: following links.next returns the next page, not the first page again', async () => {
    // 5 resources in total; page size = 2 → 3 pages
    const allResources: Resource[] = [
      {
        type: 'asset',
        key: 'a.jpg',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        content: { size: 1, etag: 'a' },
      },
      {
        type: 'asset',
        key: 'b.jpg',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        content: { size: 1, etag: 'b' },
      },
      {
        type: 'asset',
        key: 'c.jpg',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        content: { size: 1, etag: 'c' },
      },
      {
        type: 'asset',
        key: 'd.jpg',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        content: { size: 1, etag: 'd' },
      },
      {
        type: 'asset',
        key: 'e.jpg',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        content: { size: 1, etag: 'e' },
      },
    ];

    // Stub repo: honours `after` cursor by slicing from the item after the cursor
    const partialRepo = {
      listResources: (_folderKey: string, options: ListResourcesOptions) =>
        LaikaStream.make<Resource, ListResourcesDone>(emit =>
          Effect.gen(function*() {
            const p = options.pagination as { after?: string, perPage: number } | { offset: number, limit: number };
            let items: Resource[];
            if ('after' in p && p.after) {
              const idx = allResources.findIndex(r => r.key === p.after);
              const perPage = p.perPage;
              items = idx >= 0 ? allResources.slice(idx + 1, idx + 1 + perPage) : allResources.slice(0, perPage);
            } else {
              const limit = 'limit' in p ? p.limit : p.perPage;
              items = allResources.slice(0, limit);
            }
            for (const r of items) yield* emit.data(r);
            return { total: items.length };
          })
        ),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });

    // Page 1 — use shared codec params: page[size] (not the old page[limit])
    const res1 = await api.fetch(new Request('http://localhost/api/assets/resources?page[size]=2'));
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as {
      data: Array<{ id: string }>,
      links: { next?: string | null },
    };
    expect(body1.data.map(d => d.id)).toEqual(['a.jpg', 'b.jpg']);
    expect(body1.links.next).toBeTruthy();

    // Page 2: follow links.next — must NOT return the same first page
    const res2 = await api.fetch(new Request(body1.links.next!));
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as {
      data: Array<{ id: string }>,
      links: { next?: string | null },
    };
    expect(body2.data.map(d => d.id)).toEqual(['c.jpg', 'd.jpg']);
    expect(body2.links.next).toBeTruthy();

    // Page 3: follow links.next — last page, no next link
    const res3 = await api.fetch(new Request(body2.links.next!));
    expect(res3.status).toBe(200);
    const body3 = await res3.json() as {
      data: Array<{ id: string }>,
      links: { next?: string | null },
    };
    expect(body3.data.map(d => d.id)).toEqual(['e.jpg']);
    expect(body3.links.next).toBeFalsy(); // absent on last page (undefined or null)
  });

  it('still returns 204 No Content on a clean delete with no warnings', async () => {
    const partialRepo = {
      getResource: (key: string) =>
        LaikaTask.make<ReadonlyArray<Resource>>(() =>
          Effect.succeed([{
            type: 'asset' as const,
            key,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            content: { size: 4, etag: 'e' } as Resource['content'],
          }])
        ),
      deleteAsset: (_key: string) => LaikaTask.succeed(undefined),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/pic.png', { method: 'DELETE' }),
    );
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// GET /resources — shared pagination codec (page[after] / page[before] / page[size])
// ---------------------------------------------------------------------------

describe('GET /resources — shared JSON:API pagination params', () => {
  const makeAsset = (key: string): Resource => ({
    type: 'asset',
    key,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    content: { size: 1, etag: key },
  });

  const allResources: Resource[] = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'].map(makeAsset);

  const makeRepo = (): AssetsRepository => ({
    listResources: (_folderKey: string, options: ListResourcesOptions) =>
      LaikaStream.make<Resource, ListResourcesDone>(emit =>
        Effect.gen(function*() {
          const p = options.pagination as { after?: string, perPage: number } | { offset: number, limit: number };
          let items: Resource[];
          if ('after' in p && p.after) {
            const idx = allResources.findIndex(r => r.key === p.after);
            items = idx >= 0 ? allResources.slice(idx + 1, idx + 1 + p.perPage) : [];
          } else {
            const limit = 'limit' in p ? p.limit : p.perPage;
            items = allResources.slice(0, limit);
          }
          for (const r of items) yield* emit.data(r);
          return { total: allResources.length };
        })
      ),
  } as unknown as AssetsRepository);

  it('page[size] controls items per page on first page', async () => {
    const api = buildAssetsApi({ repository: makeRepo() });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources?page[size]=2'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }>, links: { next?: string } };
    expect(body.data.map(d => d.id)).toEqual(['a.jpg', 'b.jpg']);
    expect(body.links.next).toContain('page[after]=');
    expect(body.links.next).toContain('page[size]=2');
  });

  it('page[after] advances to the next cursor page', async () => {
    const api = buildAssetsApi({ repository: makeRepo() });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources?page[after]=b.jpg&page[size]=2'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(body.data.map(d => d.id)).toEqual(['c.jpg', 'd.jpg']);
  });

  it('links.next carries page[after] pointing to the last item on the page', async () => {
    const api = buildAssetsApi({ repository: makeRepo() });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources?page[size]=2'));
    const body = await res.json() as { links: { next?: string } };
    expect(body.links.next).toBeDefined();
    const nextUrl = new URL(body.links.next!);
    expect(nextUrl.searchParams.get('page[after]')).toBe('b.jpg');
  });
});

// ---------------------------------------------------------------------------
// GET /capabilities
// ---------------------------------------------------------------------------

describe('GET /capabilities', () => {
  it('returns 200 with assets-capabilities JSON:API resource', async () => {
    const capabilities = {
      compatibilityDate: '2026-01-01' as unknown as import('laikacms/assets').AssetsCapabilities['compatibilityDate'],
      pagination: { cursor: true, offset: false },
    };
    const partialRepo = {
      getCapabilities: () => LaikaTask.succeed(capabilities),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/capabilities'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string, attributes: typeof capabilities } };
    expect(body.data.type).toBe('assets-capabilities');
    expect(body.data.id).toBe('self');
    expect(body.data.attributes.compatibilityDate).toBe('2026-01-01');
  });

  it('returns mapped HTTP status when repo fails', async () => {
    const partialRepo = {
      getCapabilities: () => LaikaTask.make(() => Effect.fail(new NotFoundError('capabilities unavailable'))),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/capabilities'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
  });
});

// ---------------------------------------------------------------------------
// GET /resources/:key
// ---------------------------------------------------------------------------

describe('GET /resources/:key', () => {
  it('returns 200 with a JSON:API asset resource', async () => {
    const asset: Asset = {
      type: 'asset',
      key: 'images/photo.jpg',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      content: { size: 1024, etag: 'abc123' },
    };
    const partialRepo = {
      getResource: (_key: string) => LaikaTask.make<ReadonlyArray<Resource>>(() => Effect.succeed([asset])),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources/images%2Fphoto.jpg'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string, attributes: { content: { size: number } } } };
    expect(body.data.type).toBe('asset');
    expect(body.data.id).toBe('images/photo.jpg');
    expect(body.data.attributes.content.size).toBe(1024);
  });

  it('returns 404 when resource is not found', async () => {
    const partialRepo = {
      getResource: (_key: string) =>
        LaikaTask.make<ReadonlyArray<Resource>>(() => Effect.fail(new NotFoundError('Resource not found'))),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources/missing.jpg'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('404');
  });
});

// ---------------------------------------------------------------------------
// POST /resources — asset via JSON:API (base64 content)
// ---------------------------------------------------------------------------

describe('POST /resources — asset via JSON:API', () => {
  it('returns 201 with a JSON:API asset after creating via base64 content', async () => {
    const createdAsset: Asset = {
      type: 'asset',
      key: 'uploads/hello.txt',
      createdAt: '2026-06-24T00:00:00Z',
      updatedAt: '2026-06-24T00:00:00Z',
      content: { size: 5, etag: 'hello-etag' },
    };
    const partialRepo = {
      createAsset: () => LaikaTask.succeed(createdAsset),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const base64Content = btoa('hello');
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'asset',
            id: 'uploads/hello.txt',
            attributes: {
              mimeType: 'text/plain',
              content: base64Content,
            },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('asset');
    expect(body.data.id).toBe('uploads/hello.txt');
  });

  it('returns 400 when content attribute is missing', async () => {
    const api = buildAssetsApi({ repository: {} as AssetsRepository });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'asset',
            id: 'uploads/no-content.txt',
            attributes: { mimeType: 'text/plain' },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors[0]?.status).toBe('400');
  });
});

// ---------------------------------------------------------------------------
// POST /resources — folder via JSON:API
// ---------------------------------------------------------------------------

describe('POST /resources — folder via JSON:API', () => {
  it('returns 201 with a JSON:API folder resource', async () => {
    const createdFolder: Folder = {
      type: 'folder',
      key: 'my-folder/',
      createdAt: '2026-06-24T00:00:00Z',
      updatedAt: '2026-06-24T00:00:00Z',
    };
    const partialRepo = {
      createFolder: () => LaikaTask.succeed(createdFolder),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'folder',
            id: 'my-folder/',
            attributes: {},
          },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('folder');
    expect(body.data.id).toBe('my-folder/');
  });
});

// ---------------------------------------------------------------------------
// PATCH /resources/:key
// ---------------------------------------------------------------------------

describe('PATCH /resources/:key', () => {
  it('returns 200 with updated JSON:API asset', async () => {
    const updatedAsset: Asset = {
      type: 'asset',
      key: 'photo.jpg',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-06-24T00:00:00Z',
      content: { size: 512, etag: 'new-etag' },
    };
    const partialRepo = {
      updateAsset: () => LaikaTask.succeed(updatedAsset),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/photo.jpg', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'asset',
            attributes: { cacheControl: 'max-age=3600' },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('asset');
    expect(body.data.id).toBe('photo.jpg');
  });
});

// ---------------------------------------------------------------------------
// DELETE /resources/:key
// ---------------------------------------------------------------------------

describe('DELETE /resources/:key', () => {
  it('returns 404 when the resource does not exist', async () => {
    const partialRepo = {
      getResource: (_key: string) =>
        LaikaTask.make<ReadonlyArray<Resource>>(() => Effect.fail(new NotFoundError('no such resource'))),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/ghost.png', { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('404');
    expect(body.errors[0]?.code).toBe('not_found');
  });

  it('returns 204 on clean deletion of a folder', async () => {
    const partialRepo = {
      getResource: (key: string) =>
        LaikaTask.make<ReadonlyArray<Resource>>(() =>
          Effect.succeed([{
            type: 'folder' as const,
            key,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          }])
        ),
      deleteFolder: (_key: string, _recursive: boolean) => LaikaTask.succeed(undefined),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/empty-folder/', { method: 'DELETE' }),
    );
    expect(res.status).toBe(204);
  });
});
