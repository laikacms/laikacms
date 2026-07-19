import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternalError, InvalidData, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';

import { AssetsJsonApiProxyRepository } from './assets-jsonapi-proxy-repository.js';

/** Decode a captured fetch body (string or encoded Uint8Array) back to JSON. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors JSON.parse's return type
const parseBody = (body: unknown): any =>
  JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body as Uint8Array));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });

const noContent = () => new Response(null, { status: 204 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AssetsJsonApiProxyRepository.deleteAsset', () => {
  it('re-emits meta.warnings from a 200 DELETE response as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          meta: {
            deleted: true,
            warnings: [
              {
                code: 'not_found',
                status: '404',
                title: 'Not Found',
                detail: 'orphan thumbnail left behind',
              },
            ],
          },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.deleteAsset('pic.png'));

    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
    expect(collected.recoverableErrors[0]!.message).toContain('orphan thumbnail');
  });

  it('does not crash on a 204 No Content response (clean delete)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => noContent()));
    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.deleteAsset('pic.png'));
    expect(collected.recoverableErrors).toEqual([]);
  });
});

describe('AssetsJsonApiProxyRepository.deleteAssets', () => {
  it('re-emits per-key meta.warnings while reporting removed count', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/orphan.png')) {
        return jsonResponse({
          meta: {
            deleted: true,
            warnings: [{ code: 'not_found', status: '404', title: 'NF', detail: 'thumbnail missed' }],
          },
        });
      }
      return noContent();
    });
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.deleteAssets(['orphan.png', 'clean.png']),
    );

    expect(collected.data).toEqual(['orphan.png', 'clean.png']);
    expect(collected.done).toEqual({ removed: 2, skipped: 0 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]!.message).toContain('thumbnail missed');
  });
});

describe('AssetsJsonApiProxyRepository.listResources — filters & cursor pagination', () => {
  const assetItem = (id: string) => ({
    type: 'asset',
    id,
    attributes: { content: {} },
  });

  it('serializes options.filters as filter[<name>] query params', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaStream.runPromiseCollect(
      proxy.listResources('', {
        depth: 1,
        pagination: { offset: 0, limit: 10 },
        filters: { search: 'logo' },
      }),
    );

    const calledUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(calledUrl.searchParams.get('filter[search]')).toBe('logo');
  });

  it('cursor start ({ after: undefined }) sends an empty-but-present page[after]= param', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaStream.runPromiseCollect(
      proxy.listResources('', { depth: 1, pagination: { after: undefined, perPage: 100 } }),
    );

    const calledUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(calledUrl.searchParams.has('page[after]')).toBe(true);
    expect(calledUrl.searchParams.get('page[after]')).toBe('');
    expect(calledUrl.searchParams.get('page[size]')).toBe('100');
  });

  it('parses links.next into done.pagination { after, perPage } and omits the total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [assetItem('a.png'), assetItem('b.png')],
          links: { next: 'http://upstream/resources?page%5Bafter%5D=ABC&page%5Bsize%5D=50' },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listResources('', { depth: 1, pagination: { after: undefined, perPage: 50 } }),
    );

    expect(collected.data).toHaveLength(2);
    expect(collected.done.pagination).toEqual({ after: 'ABC', perPage: 50 });
    // With a continuation pending and no meta.page.total, the emitted count
    // must not masquerade as a total.
    expect(collected.done.total).toBeUndefined();
  });

  it('without links.next, done has no pagination and total falls back to the emitted count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [assetItem('a.png'), assetItem('b.png')] })),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listResources('', { depth: 1, pagination: { after: undefined, perPage: 50 } }),
    );

    expect(collected.done.pagination).toBeUndefined();
    expect(collected.done.total).toBe(2);
  });
});

describe('AssetsJsonApiProxyRepository.listResources', () => {
  it('uses meta.page.total for Done.total instead of emitted count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              type: 'asset',
              id: 'images/a.png',
              attributes: {
                type: 'asset',
                content: {},
              },
            },
          ],
          meta: { page: { total: 150 } },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listResources('images/', { depth: 1 }),
    );

    expect(collected.data).toHaveLength(1);
    expect(collected.done.total).toBe(150);
  });
});

// ─── getCapabilities ──────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.getCapabilities', () => {
  it('returns capabilities decoded from GET /capabilities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            attributes: {
              compatibilityDate: '2026-05-11',
              pagination: {
                supported: true,
                description: 'offset pagination',
                styles: { offset: true, page: false, cursor: false },
              },
            },
          },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const { value } = await LaikaTask.runPromiseCollect(proxy.getCapabilities());

    expect(value.pagination.supported).toBe(true);
    expect(value.pagination.styles.offset).toBe(true);
  });

  it('caches the result so fetch is called only once across two invocations', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          attributes: {
            compatibilityDate: '2026-05-11',
            pagination: {
              supported: true,
              description: 'all styles',
              styles: { offset: true, page: true, cursor: true },
            },
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaTask.runPromiseCollect(proxy.getCapabilities());
    await LaikaTask.runPromiseCollect(proxy.getCapabilities());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the conservative default when the upstream returns an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            errors: [{ code: 'not_found', status: '404', title: 'NF', detail: 'no capabilities endpoint' }],
          }),
          { status: 404, headers: { 'Content-Type': 'application/vnd.api+json' } },
        )
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const { value } = await LaikaTask.runPromiseCollect(proxy.getCapabilities());

    expect(value.pagination.supported).toBe(true);
    // The conservative default must not advertise filters the unknown
    // upstream may not honor.
    expect(value.filtering?.supported).toBe(false);
  });
});

// ─── getResource ─────────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.getResource', () => {
  it('returns a Resource decoded from GET /resources/{key}', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          type: 'asset',
          id: 'images/photo.jpg',
          attributes: {},
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getResource('images/photo.jpg'));

    expect(collected.value).toHaveLength(1);
    expect(collected.value[0]!.key).toBe('images/photo.jpg');
    expect(collected.value[0]!.type).toBe('asset');
    const calledUrl: string = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain(encodeURIComponent('images/photo.jpg'));
  });

  it('re-emits upstream meta.warnings as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'asset',
            id: 'images/photo.jpg',
            attributes: {},
          },
          meta: {
            warnings: [
              { code: 'not_found', status: '404', title: 'Not Found', detail: 'thumbnail missing' },
            ],
          },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getResource('images/photo.jpg'));

    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
    expect(collected.recoverableErrors[0]!.message).toContain('thumbnail missing');
  });

  it('rejects with a LaikaError on a non-ok JSON:API error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            errors: [{ code: 'not_found', status: '404', title: 'Not Found', detail: 'no such resource' }],
          }),
          { status: 404, headers: { 'Content-Type': 'application/vnd.api+json' } },
        )
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaTask.runPromiseCollect(proxy.getResource('images/ghost.jpg')),
    ).rejects.toBeInstanceOf(InvalidData);
  });

  it('adds include=variations,urls query params when hints are set', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { type: 'asset', id: 'images/photo.jpg', attributes: {} },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaTask.runPromiseCollect(
      proxy.getResource('images/photo.jpg', { hints: { variations: true, urls: true } }),
    );

    const calledUrl: string = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('include=variations%2Curls');
  });
});

// ─── getAsset ─────────────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.getAsset', () => {
  it('returns an Asset decoded from GET /resources/{key}', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'asset', id: 'images/photo.jpg', attributes: {} },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getAsset('images/photo.jpg'));

    expect(collected.value.key).toBe('images/photo.jpg');
    expect(collected.value.type).toBe('asset');
    expect(collected.recoverableErrors).toHaveLength(0);
  });

  it('rejects with InvalidData when the resource type is not asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'folder', id: 'images/', attributes: {} },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaTask.runPromiseCollect(proxy.getAsset('images/')),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});

// ─── createAsset ─────────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.createAsset', () => {
  it('POSTs multipart FormData and returns the created Asset', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { type: 'asset', id: 'images/new.png', attributes: {} },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const content = new Uint8Array([1, 2, 3]);
    const collected = await LaikaTask.runPromiseCollect(
      proxy.createAsset({ key: 'images/new.png', content, mimeType: 'image/png' }),
    );

    expect(collected.value.key).toBe('images/new.png');
    expect(collected.value.type).toBe('asset');

    const [rawUrl, calledInit] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
    const calledUrl = String(rawUrl);
    expect(calledUrl).toMatch(/\/resources$/);
    expect(calledInit.method).toBe('POST');
    expect(calledInit.body).toBeInstanceOf(FormData);
  });

  it('re-emits upstream meta.warnings from the POST response as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'asset', id: 'images/new.png', attributes: {} },
          meta: {
            warnings: [
              { code: 'not_found', status: '404', title: 'Not Found', detail: 'thumbnail generation skipped' },
            ],
          },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const content = new Uint8Array([1, 2, 3]);
    const collected = await LaikaTask.runPromiseCollect(
      proxy.createAsset({ key: 'images/new.png', content }),
    );

    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
    expect(collected.recoverableErrors[0]!.message).toContain('thumbnail generation skipped');
  });

  it('rejects with InvalidData for unsupported content type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => noContent()));

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    // Pass an object that is not ArrayBuffer, Uint8Array, or ReadableStream
    await expect(
      LaikaTask.runPromiseCollect(
        proxy.createAsset({ key: 'images/new.png', content: 'not-a-buffer' as unknown as ArrayBuffer }),
      ),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});

// ─── updateAsset ─────────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.updateAsset', () => {
  it('PATCHes the resource and returns the updated Asset', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { type: 'asset', id: 'images/photo.jpg', attributes: { mimeType: 'image/jpeg' } },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(
      proxy.updateAsset({ key: 'images/photo.jpg', mimeType: 'image/jpeg' }),
    );

    expect(collected.value.key).toBe('images/photo.jpg');
    const [rawUrl, calledInit] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
    const calledUrl = String(rawUrl);
    expect(calledUrl).toContain(encodeURIComponent('images/photo.jpg'));
    expect(calledInit.method).toBe('PATCH');
    const body = parseBody(calledInit.body) as { data: { type: string, id: string } };
    expect(body.data.type).toBe('asset');
    expect(body.data.id).toBe('images/photo.jpg');
  });

  it('re-emits upstream meta.warnings as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'asset', id: 'images/photo.jpg', attributes: {} },
          meta: {
            warnings: [
              { code: 'not_found', status: '404', title: 'Not Found', detail: 'stale cache cleared' },
            ],
          },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(
      proxy.updateAsset({ key: 'images/photo.jpg' }),
    );

    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('rejects with a LaikaError on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            errors: [{ code: 'not_found', status: '404', title: 'Not Found', detail: 'no such asset' }],
          }),
          { status: 404, headers: { 'Content-Type': 'application/vnd.api+json' } },
        )
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaTask.runPromiseCollect(proxy.updateAsset({ key: 'images/ghost.jpg' })),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});

// ─── deleteFolder ─────────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.deleteFolder', () => {
  it('sends DELETE to /resources/{key} without ?recursive when not requested', async () => {
    const fetchMock = vi.fn(async () => noContent());
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaTask.runPromiseCollect(proxy.deleteFolder('images/'));

    const [rawUrl, calledInit] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
    const calledUrl = String(rawUrl);
    expect(calledUrl).toContain(encodeURIComponent('images/'));
    expect(calledUrl).not.toContain('recursive');
    expect(calledInit.method).toBe('DELETE');
  });

  it('appends ?recursive=true when requested', async () => {
    const fetchMock = vi.fn(async () => noContent());
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaTask.runPromiseCollect(proxy.deleteFolder('images/', true));

    const calledUrl: string = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('recursive=true');
  });

  it('re-emits meta.warnings from a 200 response as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          meta: {
            deleted: true,
            warnings: [
              { code: 'not_found', status: '404', title: 'Not Found', detail: 'child already gone' },
            ],
          },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.deleteFolder('images/'));

    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
    expect(collected.recoverableErrors[0]!.message).toContain('child already gone');
  });
});

// ─── getFolder ────────────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.getFolder', () => {
  it('returns a Folder decoded from GET /resources/{key}', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'folder', id: 'images/', attributes: {} },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getFolder('images/'));

    expect(collected.value.key).toBe('images/');
    expect(collected.value.type).toBe('folder');
    expect(collected.recoverableErrors).toHaveLength(0);
  });

  it('rejects with InvalidData when the resource type is not folder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'asset', id: 'images/photo.jpg', attributes: {} },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaTask.runPromiseCollect(proxy.getFolder('images/photo.jpg')),
    ).rejects.toBeInstanceOf(InvalidData);
  });

  it('rejects with a LaikaError on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            errors: [{ code: 'not_found', status: '404', title: 'Not Found', detail: 'no such folder' }],
          }),
          { status: 404, headers: { 'Content-Type': 'application/vnd.api+json' } },
        )
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaTask.runPromiseCollect(proxy.getFolder('images/ghost/')),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});

// ─── createFolder ─────────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.createFolder', () => {
  it('POSTs a folder resource to /resources and returns the created Folder', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { type: 'folder', id: 'uploads/', attributes: {} },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(
      proxy.createFolder({ key: 'uploads/' }),
    );

    expect(collected.value.key).toBe('uploads/');
    expect(collected.value.type).toBe('folder');

    const [rawUrl, calledInit] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
    const calledUrl = String(rawUrl);
    expect(calledUrl).toMatch(/\/resources$/);
    expect(calledInit.method).toBe('POST');
    const body = parseBody(calledInit.body) as { data: { type: string, id: string } };
    expect(body.data.type).toBe('folder');
    expect(body.data.id).toBe('uploads/');
  });

  it('re-emits upstream meta.warnings as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'folder', id: 'uploads/', attributes: {} },
          meta: {
            warnings: [
              { code: 'not_found', status: '404', title: 'Not Found', detail: 'parent path created on-demand' },
            ],
          },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(
      proxy.createFolder({ key: 'uploads/' }),
    );

    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('rejects with a LaikaError on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            errors: [{ code: 'invalid_data', status: '409', title: 'Conflict', detail: 'folder exists' }],
          }),
          { status: 409, headers: { 'Content-Type': 'application/vnd.api+json' } },
        )
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaTask.runPromiseCollect(proxy.createFolder({ key: 'existing/' })),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});

// ─── getVariations ────────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.getVariations', () => {
  it('fetches variations via getAsset with hint and returns them from the included array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'asset', id: 'images/photo.jpg', attributes: {} },
          included: [
            {
              type: 'asset-variants',
              id: 'images/photo.jpg',
              attributes: { variations: { thumbnail: { variant: 'thumbnail', url: 'https://cdn/thumb.jpg' } } },
            },
          ],
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const asset = { key: 'images/photo.jpg', type: 'asset' as const };
    const collected = await LaikaStream.runPromiseCollect(proxy.getVariations([asset]));

    expect(collected.data).toHaveLength(1);
    expect(collected.data[0]!.key).toBe('images/photo.jpg');
    expect(collected.data[0]!.variations['thumbnail']!.url).toBe('https://cdn/thumb.jpg');
    expect(collected.done.total).toBe(1);
  });

  it('emits InternalError when the hint response includes no variations for the asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'asset', id: 'images/photo.jpg', attributes: {} },
          // no included
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const asset = { key: 'images/photo.jpg', type: 'asset' as const };
    const collected = await LaikaStream.runPromiseCollect(proxy.getVariations([asset]));

    expect(collected.data).toHaveLength(0);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(InternalError);
    expect(collected.recoverableErrors[0]!.message).toContain('images/photo.jpg');
  });

  it('serves cached variations without a second fetch', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { type: 'asset', id: 'images/photo.jpg', attributes: {} },
        included: [
          {
            type: 'asset-variants',
            id: 'images/photo.jpg',
            attributes: { variations: { small: { variant: 'small', url: 'https://cdn/small.jpg' } } },
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const asset = { key: 'images/photo.jpg', type: 'asset' as const };
    // First call populates the cache
    await LaikaStream.runPromiseCollect(proxy.getVariations([asset]));
    const callsAfterFirst = fetchMock.mock.calls.length;
    // Second call should be served from cache
    const collected = await LaikaStream.runPromiseCollect(proxy.getVariations([asset]));

    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirst);
    expect(collected.data).toHaveLength(1);
  });
});

// ─── getUrls ──────────────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.getUrls', () => {
  it('fetches URLs via getAsset with hint and returns them from the included array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'asset', id: 'images/photo.jpg', attributes: {} },
          included: [
            {
              type: 'asset-url',
              id: 'images/photo.jpg',
              attributes: { url: 'https://cdn/photo.jpg', expiresAt: '2026-12-31T00:00:00Z' },
            },
          ],
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const asset = { key: 'images/photo.jpg', type: 'asset' as const };
    const collected = await LaikaStream.runPromiseCollect(proxy.getUrls([asset]));

    expect(collected.data).toHaveLength(1);
    expect(collected.data[0]!.key).toBe('images/photo.jpg');
    expect(collected.data[0]!.url).toBe('https://cdn/photo.jpg');
    expect(collected.done.total).toBe(1);
  });

  it('emits InternalError when hint response includes no URL for the asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'asset', id: 'images/photo.jpg', attributes: {} },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const asset = { key: 'images/photo.jpg', type: 'asset' as const };
    const collected = await LaikaStream.runPromiseCollect(proxy.getUrls([asset]));

    expect(collected.data).toHaveLength(0);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(InternalError);
  });

  it('serves cached URLs without a second fetch for multi-asset input', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = new URL(url);
      const key = decodeURIComponent(u.pathname.replace('/resources/', ''));
      return jsonResponse({
        data: { type: 'asset', id: key, attributes: {} },
        included: [
          {
            type: 'asset-url',
            id: key,
            attributes: { url: `https://cdn/${key}` },
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const assets = [
      { key: 'images/a.jpg', type: 'asset' as const },
      { key: 'images/b.jpg', type: 'asset' as const },
    ];
    const collected = await LaikaStream.runPromiseCollect(proxy.getUrls(assets));

    expect(collected.data).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─── getMetadata ──────────────────────────────────────────────────────────────

describe('AssetsJsonApiProxyRepository.getMetadata', () => {
  it('fetches metadata via getAsset with hint and returns it from the asset meta field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'asset',
            id: 'images/photo.jpg',
            attributes: {},
            meta: { kind: 'image', size: 12345, mimeType: 'image/jpeg', width: 800, height: 600 },
          },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const asset = { key: 'images/photo.jpg', type: 'asset' as const };
    const collected = await LaikaStream.runPromiseCollect(proxy.getMetadata([asset]));

    expect(collected.data).toHaveLength(1);
    expect(collected.data[0]!.key).toBe('images/photo.jpg');
    expect(collected.data[0]!.metadata).toMatchObject({ kind: 'image', size: 12345 });
    expect(collected.done.total).toBe(1);
  });

  it('emits InternalError when hint response has no meta for the asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { type: 'asset', id: 'images/photo.jpg', attributes: {} },
          // no meta on the resource
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const asset = { key: 'images/photo.jpg', type: 'asset' as const };
    const collected = await LaikaStream.runPromiseCollect(proxy.getMetadata([asset]));

    expect(collected.data).toHaveLength(0);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(InternalError);
  });

  it('serves cached metadata without a second fetch', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          type: 'asset',
          id: 'images/photo.jpg',
          attributes: {},
          meta: { kind: 'binary', size: 100, mimeType: 'application/octet-stream' },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const asset = { key: 'images/photo.jpg', type: 'asset' as const };
    await LaikaStream.runPromiseCollect(proxy.getMetadata([asset]));
    const callsAfterFirst = fetchMock.mock.calls.length;
    await LaikaStream.runPromiseCollect(proxy.getMetadata([asset]));

    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirst);
  });
});

describe('AssetsJsonApiProxyRepository change signals', () => {
  it('getSyncToken parses attributes.syncToken and forwards filter[folder]', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { type: 'sync-token', id: 'images', attributes: { syncToken: 'tok-7', folder: 'images' } },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const token = await LaikaTask.runPromise(proxy.getSyncToken({ folder: 'images' }));

    expect(token).toBe('tok-7');
    const calledUrl = decodeURIComponent(String(fetchMock.mock.calls[0]![0]));
    expect(calledUrl).toContain('/sync-token');
    expect(calledUrl).toContain('filter[folder]=images');
  });

  it('getSyncToken re-hydrates NotImplementedError from a 501 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            errors: [{
              status: '501',
              code: 'not_implemented',
              title: 'Not Implemented',
              detail: 'getSyncToken is not supported by this assets repository.',
            }],
          },
          501,
        )
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(LaikaTask.runPromise(proxy.getSyncToken())).rejects.toMatchObject({
      code: 'not_implemented',
    });
  });

  it('listChanges emits change summaries and returns meta.syncToken in the done value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { type: 'change-summary', id: 'images/a.jpg', attributes: { deleted: false, version: 'etag-1' } },
            { type: 'change-summary', id: 'images/b.jpg', attributes: { deleted: true } },
          ],
          meta: { syncToken: 'tok-8', page: { total: 2 } },
        })
      ),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listChanges({ since: 'tok-7' as Parameters<typeof proxy.listChanges>[0]['since'] }),
    );

    expect(collected.data).toEqual([
      { key: 'images/a.jpg', deleted: false, version: 'etag-1' },
      { key: 'images/b.jpg', deleted: true },
    ]);
    expect(collected.done.syncToken).toBe('tok-8');
    expect(collected.done.total).toBe(2);
  });

  it('listChanges fails with InvalidData when meta.syncToken is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [], meta: {} })),
    );

    const proxy = new AssetsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaStream.runPromiseCollect(
        proxy.listChanges({ since: 'tok-7' as Parameters<typeof proxy.listChanges>[0]['since'] }),
      ),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});
