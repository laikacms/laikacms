import { afterEach, describe, expect, it, vi } from 'vitest';

import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';

import { AssetsJsonApiProxyRepository } from './assets-jsonapi-proxy-repository.js';

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
    const fetchMock = vi.fn(async (url: string) => {
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
