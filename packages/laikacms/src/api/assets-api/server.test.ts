import * as Effect from 'effect/Effect';
import type {
  Asset,
  AssetMetadata,
  AssetsRepository,
  AssetUrl,
  AssetVariations,
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
      getCapabilities: () =>
        LaikaTask.succeed({
          compatibilityDate:
            '2026-01-01' as unknown as import('laikacms/assets').AssetsCapabilities['compatibilityDate'],
          pagination: { supported: true, description: 'cursor', styles: { offset: false, page: false, cursor: true } },
        }),
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
    getCapabilities: () =>
      LaikaTask.succeed({
        compatibilityDate: '2026-01-01' as unknown as import('laikacms/assets').AssetsCapabilities['compatibilityDate'],
        pagination: {
          supported: true,
          description: 'cursor+offset',
          styles: { offset: true, page: false, cursor: true },
        },
      }),
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
// GET /resources — meta.page.total (LCMS-215)
// ---------------------------------------------------------------------------

describe('GET /resources — meta.page.total', () => {
  const makeAsset = (key: string): Resource => ({
    type: 'asset',
    key,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    content: { size: 1, etag: key },
  });

  it('meta.page.total equals the total emitted by the stream done value', async () => {
    const partialRepo = {
      listResources: (_folderKey: string, _options: ListResourcesOptions) =>
        LaikaStream.make<Resource, ListResourcesDone>(emit =>
          Effect.gen(function*() {
            yield* emit.data(makeAsset('a.jpg'));
            return { total: 42 };
          })
        ),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: Array<{ id: string }>,
      meta?: { page?: { total: number } },
    };
    expect(body.meta?.page?.total).toBe(42);
  });

  it('meta.page is absent when stream done has no total field', async () => {
    const partialRepo = {
      listResources: (_folderKey: string, _options: ListResourcesOptions) =>
        LaikaStream.make<Resource, ListResourcesDone>(emit =>
          Effect.gen(function*() {
            yield* emit.data(makeAsset('b.jpg'));
            return {} as ListResourcesDone;
          })
        ),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: Array<{ id: string }>,
      meta?: { page?: unknown },
    };
    expect(body.meta?.page).toBeUndefined();
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
// GET /resources — cursor capability guard (LCMS-264)
// ---------------------------------------------------------------------------

describe('GET /resources — cursor capability guard', () => {
  const makeAsset = (key: string): Resource => ({
    type: 'asset',
    key,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    content: { size: 1, etag: key },
  });

  const noCursorCaps = {
    compatibilityDate: '2026-01-01' as unknown as import('laikacms/assets').AssetsCapabilities['compatibilityDate'],
    pagination: {
      supported: true as const,
      description: 'offset-only',
      styles: { offset: true, page: true, cursor: false },
    },
  };

  const cursorCaps = {
    compatibilityDate: '2026-01-01' as unknown as import('laikacms/assets').AssetsCapabilities['compatibilityDate'],
    pagination: {
      supported: true as const,
      description: 'cursor+offset',
      styles: { offset: true, page: false, cursor: true },
    },
  };

  const makeNoCursorRepo = (): AssetsRepository => ({
    getCapabilities: () => LaikaTask.succeed(noCursorCaps),
    listResources: () =>
      LaikaStream.make<Resource, ListResourcesDone>(emit =>
        Effect.gen(function*() {
          yield* emit.data(makeAsset('a.jpg'));
          return { total: 1 };
        })
      ),
  } as unknown as AssetsRepository);

  const makeCursorRepo = (): AssetsRepository => ({
    getCapabilities: () => LaikaTask.succeed(cursorCaps),
    listResources: (_folderKey: string, options: ListResourcesOptions) =>
      LaikaStream.make<Resource, ListResourcesDone>(emit =>
        Effect.gen(function*() {
          const p = options.pagination as { after?: string, perPage: number } | { offset: number, limit: number };
          const items = [makeAsset('a.jpg'), makeAsset('b.jpg')];
          for (const r of items) yield* emit.data(r);
          void p;
          return { total: items.length };
        })
      ),
  } as unknown as AssetsRepository);

  it('page[after] on a cursor:false backend → 400 JSON:API error', async () => {
    const api = buildAssetsApi({ repository: makeNoCursorRepo() });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources?page[after]=photo.jpg'));
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('invalid_data');
  });

  it('page[before] on a cursor:false backend → 400 JSON:API error', async () => {
    const api = buildAssetsApi({ repository: makeNoCursorRepo() });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources?page[before]=photo.jpg'));
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('400');
    expect(body.errors[0]!.code).toBe('invalid_data');
  });

  it('page[size] without cursor params on cursor:false backend → 200 unaffected', async () => {
    const api = buildAssetsApi({ repository: makeNoCursorRepo() });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources?page[size]=10'));
    expect(res.status).toBe(200);
  });

  it('page[after] on a cursor:true backend → 200', async () => {
    const api = buildAssetsApi({ repository: makeCursorRepo() });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources?page[after]=a.jpg&page[size]=2'));
    expect(res.status).toBe(200);
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

// ---------------------------------------------------------------------------
// ?include= and ?meta= query parameters (LCMS-181)
// ---------------------------------------------------------------------------

const singleAsset: Asset = {
  type: 'asset',
  key: 'images/hero.jpg',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  content: { size: 1024, etag: 'abc' },
};

const stubAssetUrl: AssetUrl = {
  key: 'images/hero.jpg',
  url: 'https://cdn.example.com/images/hero.jpg',
};

const stubVariations: AssetVariations = {
  key: 'images/hero.jpg',
  variations: [{ key: 'thumb', url: 'https://cdn.example.com/images/hero-thumb.jpg' }],
};

const stubMetadata: AssetMetadata = {
  key: 'images/hero.jpg',
  metadata: { mimeType: 'image/jpeg', size: 1024, filename: 'hero.jpg' },
};

function makeIncludeRepo(): AssetsRepository {
  return {
    getResource: (_key: string) => LaikaTask.make<ReadonlyArray<Resource>>(() => Effect.succeed([singleAsset])),
    getUrls: (_assets: Asset[]) =>
      LaikaStream.make<AssetUrl>(emit =>
        Effect.gen(function*() {
          yield* emit.data(stubAssetUrl);
        })
      ),
    getVariations: (_assets: Asset[]) =>
      LaikaStream.make<AssetVariations>(emit =>
        Effect.gen(function*() {
          yield* emit.data(stubVariations);
        })
      ),
    getMetadata: (_assets: Asset[]) =>
      LaikaStream.make<AssetMetadata>(emit =>
        Effect.gen(function*() {
          yield* emit.data(stubMetadata);
        })
      ),
  } as unknown as AssetsRepository;
}

describe('GET /resources/:key — ?include=urls sideloads asset-url', () => {
  it('?include=urls returns asset-url in included[]', async () => {
    const api = buildAssetsApi({ repository: makeIncludeRepo() });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/images%2Fhero.jpg?include=urls'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      included?: Array<{ type: string, id: string, attributes: { url?: string } }>,
    };
    const urlResource = body.included?.find(r => r.type === 'asset-url');
    expect(urlResource).toBeDefined();
    expect(urlResource?.id).toBe('images/hero.jpg');
    expect(urlResource?.attributes.url).toBe('https://cdn.example.com/images/hero.jpg');
  });

  it('?include=asset-url (long-form alias) also sideloads asset-url', async () => {
    const api = buildAssetsApi({ repository: makeIncludeRepo() });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/images%2Fhero.jpg?include=asset-url'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      included?: Array<{ type: string }>,
    };
    expect(body.included?.some(r => r.type === 'asset-url')).toBe(true);
  });
});

describe('GET /resources/:key — ?include=variations sideloads asset-variation', () => {
  it('?include=variations returns asset-variation in included[]', async () => {
    const api = buildAssetsApi({ repository: makeIncludeRepo() });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/images%2Fhero.jpg?include=variations'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      included?: Array<{ type: string, id: string }>,
    };
    expect(body.included?.some(r => r.type === 'asset-variation')).toBe(true);
  });

  it('?include=asset-variation (long-form alias) also sideloads asset-variation', async () => {
    const api = buildAssetsApi({ repository: makeIncludeRepo() });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/images%2Fhero.jpg?include=asset-variation'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      included?: Array<{ type: string }>,
    };
    expect(body.included?.some(r => r.type === 'asset-variation')).toBe(true);
  });
});

describe('GET /resources/:key — ?meta=true inlines metadata', () => {
  it('?meta=true inlines asset metadata on data.meta', async () => {
    const api = buildAssetsApi({ repository: makeIncludeRepo() });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/images%2Fhero.jpg?meta=true'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { meta?: { mimeType?: string } },
      included?: Array<{ type: string }>,
    };
    expect(body.data.meta?.mimeType).toBe('image/jpeg');
    // metadata does NOT appear in included[] — it's inlined on data.meta
    expect(body.included?.some(r => r.type === 'asset-metadata')).toBeFalsy();
  });

  it('?include=asset-metadata alone does NOT produce metadata — must use ?meta=true', async () => {
    const api = buildAssetsApi({ repository: makeIncludeRepo() });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/images%2Fhero.jpg?include=asset-metadata'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { meta?: Record<string, unknown> },
      included?: Array<{ type: string }>,
    };
    // Neither data.meta nor included contains metadata
    expect(body.data.meta).toBeUndefined();
    expect(body.included).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Malformed JSON body — fetch() must never throw, always return a Response
// ---------------------------------------------------------------------------

describe('malformed JSON body — never throws, always returns a Response', () => {
  const api = buildAssetsApi({ repository: stubRepo });

  it('POST /resources with malformed JSON returns JSON:API 400, not a throw', async () => {
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: '{bad',
      }),
    );
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('400');
    expect(body.errors[0]?.code).toBe('invalid_data');
  });

  it('POST /resources with malformed JSON returns correct Content-Type', async () => {
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: 'not-json-at-all',
      }),
    );
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('application/vnd.api+json');
  });

  it('PATCH /resources/:key with malformed JSON returns JSON:API 400, not a throw', async () => {
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/photo.jpg', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: '{bad',
      }),
    );
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string, code: string }> };
    expect(body.errors[0]?.status).toBe('400');
    expect(body.errors[0]?.code).toBe('invalid_data');
  });

  it('PATCH /resources/:key body status matches HTTP transport status', async () => {
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/photo.jpg', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: 'totally-invalid',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors[0]?.status).toBe('400');
  });
});
