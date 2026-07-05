import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvalidData, LaikaStream, LaikaTask } from 'laikacms/core';

import { DocumentsJsonApiProxyRepository } from './documents-jsonapi-proxy-repository.js';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DocumentsJsonApiProxyRepository.deleteDocument', () => {
  it('re-emits meta.warnings from the DELETE response as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          meta: {
            deleted: true,
            warnings: [
              {
                code: 'invalid_data',
                status: '400',
                title: 'Invalid Data',
                detail: 'orphaned sidecar metadata could not be cleaned up',
              },
            ],
          },
        })
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.deleteDocument('posts/old'));

    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(InvalidData);
    expect(collected.recoverableErrors[0]!.message).toContain('orphaned sidecar');
  });

  it('returns cleanly when the DELETE response has no warnings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ meta: { deleted: true } })));
    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.deleteDocument('posts/clean'));
    expect(collected.recoverableErrors).toEqual([]);
  });
});

describe('DocumentsJsonApiProxyRepository.listRecords', () => {
  it('uses meta.page.total for Done.total instead of emitted count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              type: 'published',
              id: 'posts/a',
              attributes: {
                type: 'published',
                status: 'published',
                language: 'en',
                content: {},
              },
            },
          ],
          meta: { page: { total: 150 } },
        })
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listRecords({ folder: '', depth: 1, pagination: { offset: 0, limit: 10 } }),
    );

    expect(collected.data).toHaveLength(1);
    expect(collected.done.total).toBe(150);
  });

  it('sends filter[type]=all when type is undefined (not omitted silently)', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return jsonResponse({ data: [], meta: { page: { total: 0 } } });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaStream.runPromiseCollect(
      proxy.listRecords({ folder: '', depth: 1, pagination: { offset: 0, limit: 10 } }),
    );

    expect(capturedUrl).toContain('filter%5Btype%5D=all');
  });

  it('sends filter[type]=published when type is explicitly published', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return jsonResponse({ data: [], meta: { page: { total: 0 } } });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaStream.runPromiseCollect(
      proxy.listRecords({ folder: '', depth: 1, type: 'published', pagination: { offset: 0, limit: 10 } }),
    );

    expect(capturedUrl).toContain('filter%5Btype%5D=published');
  });
});

describe('DocumentsJsonApiProxyRepository.listRecordSummaries', () => {
  it('uses meta.page.total for Done.total instead of emitted count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              type: 'published-summary',
              id: 'posts/a',
              attributes: {
                type: 'published',
                status: 'published',
                language: 'en',
              },
            },
          ],
          meta: { page: { total: 150 } },
        })
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listRecordSummaries({ folder: '', depth: 1, pagination: { offset: 0, limit: 10 } }),
    );

    expect(collected.data).toHaveLength(1);
    expect(collected.done.total).toBe(150);
  });

  it('sends filter[type]=all when type is undefined (not omitted silently)', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return jsonResponse({ data: [], meta: { page: { total: 0 } } });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaStream.runPromiseCollect(
      proxy.listRecordSummaries({ folder: '', depth: 1, pagination: { offset: 0, limit: 10 } }),
    );

    expect(capturedUrl).toContain('filter%5Btype%5D=all');
  });

  it('sends filter[type]=unpublished when type is explicitly unpublished', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return jsonResponse({ data: [], meta: { page: { total: 0 } } });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaStream.runPromiseCollect(
      proxy.listRecordSummaries({ folder: '', depth: 1, type: 'unpublished', pagination: { offset: 0, limit: 10 } }),
    );

    expect(capturedUrl).toContain('filter%5Btype%5D=unpublished');
  });
});

describe('DocumentsJsonApiProxyRepository.listRevisions', () => {
  it('uses meta.page.total for Done.total instead of emitted count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              type: 'revision-summary',
              id: 'posts/a',
              attributes: {
                type: 'revision-summary',
                language: 'en',
                revision: 'rev-1',
              },
            },
          ],
          meta: { page: { total: 150 } },
        })
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listRevisions('posts/a', { pagination: { offset: 0, limit: 10 } }),
    );

    expect(collected.data).toHaveLength(1);
    expect(collected.done.total).toBe(150);
  });
});
