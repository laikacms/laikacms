import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvalidData, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';

import { DocumentsJsonApiProxyRepository } from './documents-jsonapi-proxy-repository.js';

// Minimal valid JSON:API resource shapes reused across tests
const publishedDoc = (id = 'posts/hello') => ({
  type: 'published',
  id,
  attributes: { type: 'published', status: 'published', language: 'en', content: { title: 'Hello' } },
});

const unpublishedDoc = (id = 'drafts/hello', status = 'draft') => ({
  type: 'unpublished',
  id,
  attributes: { type: 'unpublished', status, language: 'en', content: { title: 'Draft' } },
});

const revisionDoc = (id = 'posts/hello', revision = 'rev-abc') => ({
  type: 'revision',
  id,
  attributes: { type: 'revision', revision, language: 'en', content: {}, createdAt: '2026-01-01T00:00:00Z' },
});

/** Decode a captured fetch body (string or encoded Uint8Array) back to JSON. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors JSON.parse's return type
const parseBody = (body: unknown): any =>
  JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body as Uint8Array));

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
      vi.fn(async (url: string | URL) => {
        capturedUrl = String(url);
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
      vi.fn(async (url: string | URL) => {
        capturedUrl = String(url);
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
      vi.fn(async (url: string | URL) => {
        capturedUrl = String(url);
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
      vi.fn(async (url: string | URL) => {
        capturedUrl = String(url);
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

describe('DocumentsJsonApiProxyRepository.getCapabilities', () => {
  it('returns capabilities from the remote /capabilities endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            attributes: {
              compatibilityDate: '2026-05-11',
              pagination: {
                supported: true,
                description: 'forwarded',
                styles: { offset: true, page: true, cursor: true },
              },
            },
          },
        })
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const caps = await LaikaTask.runPromise(proxy.getCapabilities());
    expect(caps.compatibilityDate).toBe('2026-05-11');
    expect(caps.pagination?.supported).toBe(true);
  });

  it('returns the conservative fallback when /capabilities is not available (404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { errors: [{ status: '404', code: 'not_found', title: 'Not Found' }] },
          404,
        )
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const caps = await LaikaTask.runPromise(proxy.getCapabilities());
    expect(caps.pagination?.supported).toBe(true);
  });

  it('caches capabilities after the first successful call (fetch called only once)', async () => {
    const mockFetch = vi.fn(async () =>
      jsonResponse({
        data: {
          attributes: {
            compatibilityDate: '2026-05-11',
            pagination: { supported: true, styles: { offset: true, page: true, cursor: true } },
          },
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaTask.runPromise(proxy.getCapabilities());
    await LaikaTask.runPromise(proxy.getCapabilities());
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('DocumentsJsonApiProxyRepository.getDocument', () => {
  it('returns a Document with the correct key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: publishedDoc('posts/hello') })),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const doc = await LaikaTask.runPromise(proxy.getDocument('posts/hello'));
    expect(doc.key).toBe('posts/hello');
    expect(doc.type).toBe('published');
    expect(doc.content).toEqual({ title: 'Hello' });
  });

  it('URL-encodes the key in the request path', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        capturedUrl = String(url);
        return jsonResponse({ data: publishedDoc('posts/hello world') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaTask.runPromise(proxy.getDocument('posts/hello world'));
    expect(capturedUrl).toContain('/published/posts%2Fhello%20world');
  });

  it('re-emits meta.warnings from the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: publishedDoc(),
          meta: {
            warnings: [
              { code: 'invalid_data', status: '400', title: 'Invalid Data', detail: 'stale revision ref' },
            ],
          },
        })
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getDocument('posts/hello'));
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]!.message).toContain('stale revision ref');
  });
});

describe('DocumentsJsonApiProxyRepository.createDocument', () => {
  it('POSTs to /published and returns the created Document', async () => {
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedInit = init;
        return jsonResponse({ data: publishedDoc('posts/new') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const doc = await LaikaTask.runPromise(
      proxy.createDocument({
        key: 'posts/new',
        type: 'published',
        status: 'published',
        language: 'en',
        content: { body: 'Hi' },
      }),
    );
    expect(doc.key).toBe('posts/new');
    expect(capturedInit?.method).toBe('POST');
    const body = parseBody(capturedInit?.body);
    expect(body.data.type).toBe('published');
    expect(body.data.id).toBe('posts/new');
  });

  it('re-emits meta.warnings from the POST response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: publishedDoc('posts/new'),
          meta: {
            warnings: [{ code: 'invalid_data', status: '400', title: 'Warning', detail: 'normalised key' }],
          },
        })
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(
      proxy.createDocument({ key: 'posts/new', type: 'published', status: 'published', language: 'en', content: {} }),
    );
    expect(collected.recoverableErrors).toHaveLength(1);
  });
});

describe('DocumentsJsonApiProxyRepository.updateDocument', () => {
  it('PATCHes /published/:key and returns the updated Document', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return jsonResponse({ data: publishedDoc('posts/hello') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const doc = await LaikaTask.runPromise(
      proxy.updateDocument({ key: 'posts/hello', content: { title: 'Updated' } }),
    );
    expect(doc.key).toBe('posts/hello');
    expect(capturedUrl).toContain('/published/posts%2Fhello');
    expect(capturedInit?.method).toBe('PATCH');
  });
});

describe('DocumentsJsonApiProxyRepository.getUnpublished', () => {
  it('GETs /unpublished/:key and returns an Unpublished document', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        capturedUrl = String(url);
        return jsonResponse({ data: unpublishedDoc('drafts/hello') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const doc = await LaikaTask.runPromise(proxy.getUnpublished('drafts/hello'));
    expect(doc.key).toBe('drafts/hello');
    expect(doc.type).toBe('unpublished');
    expect(capturedUrl).toContain('/unpublished/drafts%2Fhello');
  });
});

describe('DocumentsJsonApiProxyRepository.createUnpublished', () => {
  it('POSTs to /unpublished and returns the created Unpublished document', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return jsonResponse({ data: unpublishedDoc('drafts/new', 'draft') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const doc = await LaikaTask.runPromise(
      proxy.createUnpublished({ key: 'drafts/new', type: 'unpublished', status: 'draft', language: 'en', content: {} }),
    );
    expect(doc.key).toBe('drafts/new');
    expect(doc.status).toBe('draft');
    expect(capturedUrl).toContain('/unpublished');
    expect(capturedInit?.method).toBe('POST');
    const body = parseBody(capturedInit?.body);
    expect(body.data.type).toBe('unpublished');
  });
});

describe('DocumentsJsonApiProxyRepository.updateUnpublished', () => {
  it('PATCHes /unpublished/:key and returns the updated Unpublished document', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return jsonResponse({ data: unpublishedDoc('drafts/hello', 'pending_review') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const doc = await LaikaTask.runPromise(
      proxy.updateUnpublished({ key: 'drafts/hello', status: 'pending_review' }),
    );
    expect(doc.status).toBe('pending_review');
    expect(capturedUrl).toContain('/unpublished/drafts%2Fhello');
    expect(capturedInit?.method).toBe('PATCH');
  });
});

describe('DocumentsJsonApiProxyRepository.deleteUnpublished', () => {
  it('DELETEs /unpublished/:key and re-emits meta.warnings', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        capturedUrl = String(url);
        return jsonResponse({
          meta: {
            deleted: true,
            warnings: [{ code: 'invalid_data', status: '400', title: 'Warning', detail: 'sidecar left behind' }],
          },
        });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.deleteUnpublished('drafts/hello'));
    expect(capturedUrl).toContain('/unpublished/drafts%2Fhello');
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]!.message).toContain('sidecar left behind');
  });

  it('returns cleanly when no warnings are present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ meta: { deleted: true } })));
    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.deleteUnpublished('drafts/clean'));
    expect(collected.recoverableErrors).toEqual([]);
  });
});

describe('DocumentsJsonApiProxyRepository.publish', () => {
  it('POSTs to /unpublished/:key/publish and returns the published Document', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return jsonResponse({ data: publishedDoc('posts/hello') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const doc = await LaikaTask.runPromise(proxy.publish('posts/hello'));
    expect(doc.key).toBe('posts/hello');
    expect(doc.type).toBe('published');
    expect(capturedUrl).toContain('/unpublished/posts%2Fhello/publish');
    expect(capturedInit?.method).toBe('POST');
  });
});

describe('DocumentsJsonApiProxyRepository.unpublish', () => {
  it('POSTs to /published/:key/unpublish with the status in the body', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return jsonResponse({ data: unpublishedDoc('posts/hello', 'archived') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const doc = await LaikaTask.runPromise(proxy.unpublish('posts/hello', 'archived'));
    expect(doc.key).toBe('posts/hello');
    expect(doc.status).toBe('archived');
    expect(capturedUrl).toContain('/published/posts%2Fhello/unpublish');
    expect(capturedInit?.method).toBe('POST');
    const body = parseBody(capturedInit?.body);
    expect(body.data.attributes.status).toBe('archived');
  });
});

describe('DocumentsJsonApiProxyRepository.getRevision', () => {
  it('GETs /revisions/:key/:revision and returns the Revision', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        capturedUrl = String(url);
        return jsonResponse({ data: revisionDoc('posts/hello', 'rev-abc') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const rev = await LaikaTask.runPromise(proxy.getRevision('posts/hello', 'rev-abc'));
    expect(rev.key).toBe('posts/hello');
    expect(rev.revision).toBe('rev-abc');
    expect(capturedUrl).toContain('/revisions/posts%2Fhello/rev-abc');
  });

  it('URL-encodes both key and revision in the request path', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        capturedUrl = String(url);
        return jsonResponse({ data: revisionDoc('posts/a b', 'rev 1') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaTask.runPromise(proxy.getRevision('posts/a b', 'rev 1'));
    expect(capturedUrl).toContain('/revisions/posts%2Fa%20b/rev%201');
  });
});

describe('DocumentsJsonApiProxyRepository error rehydration', () => {
  it('getDocument: 404 with code=not_found resolves to NotFoundError, not InvalidData', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            errors: [
              {
                status: '404',
                code: 'not_found',
                title: 'Not Found',
                detail: 'The document at key posts/missing does not exist',
              },
            ],
          },
          404,
        )
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const result = await LaikaTask.runPromiseCollect(proxy.getDocument('posts/missing')).catch(
      e => e,
    );

    expect(result).toBeInstanceOf(NotFoundError);
    expect((result as NotFoundError).code).toBe('not_found');
  });

  it('getUnpublished: 404 with code=not_found resolves to NotFoundError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            errors: [
              {
                status: '404',
                code: 'not_found',
                title: 'Not Found',
                detail: 'The document at key drafts/missing does not exist',
              },
            ],
          },
          404,
        )
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const result = await LaikaTask.runPromiseCollect(proxy.getUnpublished('drafts/missing')).catch(
      e => e,
    );

    expect(result).toBeInstanceOf(NotFoundError);
  });

  it('getDocument: error without code field falls back to InvalidData', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            errors: [
              {
                status: '422',
                title: 'Unprocessable Entity',
                detail: 'Some unknown error',
              },
            ],
          },
          422,
        )
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const result = await LaikaTask.runPromiseCollect(proxy.getDocument('posts/bad')).catch(e => e);

    expect(result).toBeInstanceOf(InvalidData);
  });
});

describe('DocumentsJsonApiProxyRepository.createRevision', () => {
  it('POSTs to /revisions with correct JSON:API body and returns a Revision', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return jsonResponse({ data: revisionDoc('posts/hello', 'rev-new') });
      }),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const create = {
      key: 'posts/hello',
      type: 'revision' as const,
      revision: 'rev-new',
      language: 'en',
      content: { title: 'Hello' },
    };
    const rev = await LaikaTask.runPromise(proxy.createRevision(create));

    expect(rev.key).toBe('posts/hello');
    expect(rev.revision).toBe('rev-new');
    expect(capturedUrl).toContain('/revisions');
    expect(capturedInit?.method).toBe('POST');

    const body = parseBody(capturedInit?.body);
    expect(body.data.type).toBe('revision');
    expect(body.data.id).toBe('posts/hello');
    expect(body.data.attributes.revision).toBe('rev-new');
  });

  it('re-emits meta.warnings from the POST response as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: revisionDoc('posts/hello', 'rev-warn'),
          meta: {
            warnings: [
              {
                code: 'invalid_data',
                status: '400',
                title: 'Invalid Data',
                detail: 'revision content had an unrecognised field',
              },
            ],
          },
        })
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const create = {
      key: 'posts/hello',
      type: 'revision' as const,
      revision: 'rev-warn',
      language: 'en',
      content: { title: 'Hello' },
    };
    const collected = await LaikaTask.runPromiseCollect(proxy.createRevision(create));

    expect(collected.value.key).toBe('posts/hello');
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(InvalidData);
    expect(collected.recoverableErrors[0]!.message).toContain('unrecognised field');
  });

  it('returns cleanly when the POST response has no warnings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: revisionDoc('posts/clean', 'rev-clean') })),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const create = {
      key: 'posts/clean',
      type: 'revision' as const,
      revision: 'rev-clean',
      language: 'en',
      content: {},
    };
    const collected = await LaikaTask.runPromiseCollect(proxy.createRevision(create));

    expect(collected.value.key).toBe('posts/clean');
    expect(collected.recoverableErrors).toEqual([]);
  });
});

describe('DocumentsJsonApiProxyRepository change signals', () => {
  it('getSyncToken parses attributes.syncToken and forwards filter[folder]', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { type: 'sync-token', id: 'posts', attributes: { syncToken: 'tok-42', folder: 'posts' } },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const token = await LaikaTask.runPromise(proxy.getSyncToken({ folder: 'posts' }));

    expect(token).toBe('tok-42');
    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain('/sync-token');
    expect(decodeURIComponent(calledUrl)).toContain('filter[folder]=posts');
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
              detail: 'getSyncToken is not supported by this documents repository.',
            }],
          },
          501,
        )
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(LaikaTask.runPromise(proxy.getSyncToken())).rejects.toMatchObject({
      code: 'not_implemented',
    });
  });

  it('getSyncToken fails with InvalidData when the token is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: { type: 'sync-token', id: 'self', attributes: {} } })),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(LaikaTask.runPromise(proxy.getSyncToken())).rejects.toBeInstanceOf(InvalidData);
  });

  it('listChanges emits change summaries and returns meta.syncToken in the done value', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { type: 'change-summary', id: 'posts/a', attributes: { deleted: false, version: 'v7' } },
          { type: 'change-summary', id: 'posts/b', attributes: { deleted: true } },
        ],
        meta: { syncToken: 'tok-99', page: { total: 2 } },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listChanges({ since: 'tok-42' as Parameters<typeof proxy.listChanges>[0]['since'] }),
    );

    expect(collected.data).toEqual([
      { key: 'posts/a', deleted: false, version: 'v7' },
      { key: 'posts/b', deleted: true },
    ]);
    expect(collected.done.syncToken).toBe('tok-99');
    expect(collected.done.total).toBe(2);
    const calledUrl = decodeURIComponent(String(fetchMock.mock.calls[0]![0]));
    expect(calledUrl).toContain('/changes');
    expect(calledUrl).toContain('filter[since]=tok-42');
  });

  it('listChanges fails with InvalidData when meta.syncToken is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [], meta: {} })),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaStream.runPromiseCollect(
        proxy.listChanges({ since: 'tok-42' as Parameters<typeof proxy.listChanges>[0]['since'] }),
      ),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});

describe('DocumentsJsonApiProxyRepository version passthrough', () => {
  it('getDocument surfaces the version attribute from the upstream resource', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'published',
            id: 'posts/hello',
            attributes: {
              type: 'published',
              status: 'published',
              language: 'en',
              content: { title: 'Hello' },
              version: 'v7',
            },
          },
        })
      ),
    );

    const proxy = new DocumentsJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const doc = await LaikaTask.runPromise(proxy.getDocument('posts/hello'));

    expect(doc.version).toBe('v7');
  });
});
