import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvalidData, LaikaTask } from 'laikacms/core';

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
