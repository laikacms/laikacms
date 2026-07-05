import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvalidData, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';

import { StorageJsonApiProxyRepository } from './storage-jsonapi-proxy-repository.js';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StorageJsonApiProxyRepository.listAtoms', () => {
  it('re-emits upstream meta.warnings as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              type: 'folder',
              id: 'good-subfolder',
              attributes: {
                type: 'folder',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              },
            },
          ],
          meta: {
            page: { total: 1 },
            warnings: [
              {
                code: 'not_found',
                status: '404',
                title: 'Not Found',
                detail: 'hidden-subfolder vanished mid-walk',
              },
            ],
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listAtoms('root', { depth: 1, pagination: { offset: 0, limit: 10 } }),
    );

    expect(collected.data.map(a => a.key)).toEqual(['good-subfolder']);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
    expect(collected.recoverableErrors[0]!.message).toContain('hidden-subfolder');
  });

  it('tolerates an upstream meta with no warnings field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [],
          meta: { page: { total: 0 } },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listAtoms('root', { depth: 1, pagination: { offset: 0, limit: 10 } }),
    );

    expect(collected.data).toEqual([]);
    expect(collected.recoverableErrors).toEqual([]);
  });

  it('uses meta.page.total for Done.total instead of emitted count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              type: 'object',
              id: 'notes/a',
              attributes: {
                type: 'object',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                content: {},
              },
            },
          ],
          meta: { page: { total: 150 } },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listAtoms('root', { depth: 1, pagination: { offset: 0, limit: 10 } }),
    );

    expect(collected.data).toHaveLength(1);
    expect(collected.done.total).toBe(150);
  });
});

describe('StorageJsonApiProxyRepository.listAtomSummaries', () => {
  it('uses meta.page.total for Done.total instead of emitted count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              type: 'object-summary',
              id: 'notes/a',
              attributes: {
                type: 'object-summary',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              },
            },
          ],
          meta: { page: { total: 150 } },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.listAtomSummaries('root', { depth: 1, pagination: { offset: 0, limit: 10 } }),
    );

    expect(collected.data).toHaveLength(1);
    expect(collected.done.total).toBe(150);
  });
});

describe('StorageJsonApiProxyRepository.createObject', () => {
  it('re-emits upstream meta.warnings from a single-resource POST as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'object',
            id: 'notes/hello',
            attributes: {
              type: 'object',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              content: { body: 'hi' },
            },
          },
          meta: {
            warnings: [
              {
                code: 'not_found',
                status: '404',
                title: 'Not Found',
                detail: 'readback failed; synthesized from write input',
              },
            ],
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(
      proxy.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );

    expect(collected.value.key).toBe('notes/hello');
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
    expect(collected.recoverableErrors[0]!.message).toContain('readback');
  });
});

describe('StorageJsonApiProxyRepository.createOrUpdateObject', () => {
  it('forwards warnings from the inner getObject + updateObject delegation chain', async () => {
    // createOrUpdate calls getObject first (to decide create vs update) then
    // calls updateObject. Both inner tasks may emit warnings if the upstream
    // attached meta.warnings to either response. The delegation should
    // forward both into the outer task — not drop them at runValue.
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === '/objects/notes%2Fhello' && (!init || init.method === 'GET')) {
        // getObject upstream succeeds — but emits a warning on the read
        return jsonResponse({
          data: {
            type: 'object',
            id: 'notes/hello',
            attributes: {
              type: 'object',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              content: { body: 'old' },
            },
          },
          meta: {
            warnings: [{ code: 'not_found', status: '404', title: 'NF', detail: 'getObject warn' }],
          },
        });
      }
      // PATCH /objects/<key> (updateObject) — succeeds with its own warning
      return jsonResponse({
        data: {
          type: 'object',
          id: 'notes/hello',
          attributes: {
            type: 'object',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            content: { body: 'new' },
          },
        },
        meta: {
          warnings: [{ code: 'not_found', status: '404', title: 'NF', detail: 'updateObject warn' }],
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(
      proxy.createOrUpdateObject({ type: 'object', key: 'notes/hello', content: { body: 'new' } }),
    );

    expect(collected.value.key).toBe('notes/hello');
    // BOTH inner tasks' warnings should propagate to the outer caller — not
    // just one, since the delegation forwards each.
    const messages = collected.recoverableErrors.map(e => e.message);
    expect(messages.some(m => m.includes('getObject warn'))).toBe(true);
    expect(messages.some(m => m.includes('updateObject warn'))).toBe(true);
  });
});

describe('StorageJsonApiProxyRepository.removeAtoms', () => {
  it('re-emits per-result atomic meta.warnings as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          'atomic:results': [
            {
              meta: {
                deleted: true,
                ref: { type: 'atom', id: 'notes/a' },
                warnings: [
                  {
                    code: 'invalid_data',
                    status: '400',
                    title: 'Invalid Data',
                    detail: 'orphaned sidecar for notes/a could not be cleaned',
                  },
                ],
              },
            },
            { meta: { deleted: true, ref: { type: 'atom', id: 'notes/b' } } },
          ],
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaStream.runPromiseCollect(
      proxy.removeAtoms(['notes/a', 'notes/b']),
    );

    // Both keys were removed; the per-result warning surfaces as a local
    // recoverableError without affecting the success count.
    expect(collected.data).toEqual(['notes/a', 'notes/b']);
    expect(collected.done).toEqual({ removed: 2, skipped: 0 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]!.message).toContain('orphaned sidecar');
  });
});

// ─── getObject ───────────────────────────────────────────────────────────────

describe('StorageJsonApiProxyRepository.getObject', () => {
  it('returns a StorageObject decoded from the JSON:API response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'object',
            id: 'notes/hello',
            attributes: {
              type: 'object',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              content: { body: 'hi' },
            },
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getObject('notes/hello'));

    expect(collected.value.key).toBe('notes/hello');
    expect(collected.value.content).toEqual({ body: 'hi' });
    expect(collected.recoverableErrors).toHaveLength(0);
  });

  it('URL-encodes the key in the request path', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          type: 'object',
          id: 'notes/hello world',
          attributes: {
            type: 'object',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            content: {},
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaTask.runPromiseCollect(proxy.getObject('notes/hello world'));

    const calledUrl: string = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain(encodeURIComponent('notes/hello world'));
  });

  it('re-emits upstream meta.warnings as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'object',
            id: 'notes/hello',
            attributes: {
              type: 'object',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              content: {},
            },
          },
          meta: {
            warnings: [
              { code: 'not_found', status: '404', title: 'Not Found', detail: 'stale replica' },
            ],
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getObject('notes/hello'));

    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
    expect(collected.recoverableErrors[0]!.message).toContain('stale replica');
  });

  it('rejects with a LaikaError on a non-ok JSON:API error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            errors: [
              { code: 'not_found', status: '404', title: 'Not Found', detail: 'object missing' },
            ],
          }),
          { status: 404, headers: { 'Content-Type': 'application/vnd.api+json' } },
        )
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaTask.runPromiseCollect(proxy.getObject('notes/missing')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── updateObject ─────────────────────────────────────────────────────────────

describe('StorageJsonApiProxyRepository.updateObject', () => {
  it('returns an updated StorageObject decoded from the PATCH response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'object',
            id: 'notes/hello',
            attributes: {
              type: 'object',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-02T00:00:00Z',
              content: { body: 'updated' },
            },
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(
      proxy.updateObject({ key: 'notes/hello', content: { body: 'updated' } }),
    );

    expect(collected.value.key).toBe('notes/hello');
    expect(collected.value.content).toEqual({ body: 'updated' });
    expect(collected.recoverableErrors).toHaveLength(0);
  });

  it('re-emits upstream meta.warnings as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'object',
            id: 'notes/hello',
            attributes: {
              type: 'object',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-02T00:00:00Z',
              content: { body: 'updated' },
            },
          },
          meta: {
            warnings: [
              { code: 'not_found', status: '404', title: 'Not Found', detail: 'readback skipped' },
            ],
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(
      proxy.updateObject({ key: 'notes/hello', content: { body: 'updated' } }),
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
            errors: [{ code: 'not_found', status: '404', title: 'Not Found', detail: 'gone' }],
          }),
          { status: 404, headers: { 'Content-Type': 'application/vnd.api+json' } },
        )
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaTask.runPromiseCollect(proxy.updateObject({ key: 'notes/missing', content: {} })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── getFolder ────────────────────────────────────────────────────────────────

describe('StorageJsonApiProxyRepository.getFolder', () => {
  it('returns a Folder decoded from the JSON:API response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'folder',
            id: 'notes',
            attributes: {
              type: 'folder',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getFolder('notes'));

    expect(collected.value.key).toBe('notes');
    expect(collected.value.type).toBe('folder');
    expect(collected.recoverableErrors).toHaveLength(0);
  });

  it('re-emits upstream meta.warnings as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'folder',
            id: 'notes',
            attributes: {
              type: 'folder',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          },
          meta: {
            warnings: [
              { code: 'not_found', status: '404', title: 'Not Found', detail: 'subfolder inaccessible' },
            ],
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getFolder('notes'));

    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
    expect(collected.recoverableErrors[0]!.message).toContain('subfolder inaccessible');
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

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaTask.runPromiseCollect(proxy.getFolder('ghost')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── createFolder ─────────────────────────────────────────────────────────────

describe('StorageJsonApiProxyRepository.createFolder', () => {
  it('returns a Folder decoded from the POST /atoms response', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          type: 'folder',
          id: 'drafts',
          attributes: {
            type: 'folder',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(
      proxy.createFolder({ key: 'drafts' }),
    );

    expect(collected.value.key).toBe('drafts');
    expect(collected.value.type).toBe('folder');
    // POSTed to /atoms, not /folders
    const calledUrl: string = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toMatch(/\/atoms$/);
    expect(collected.recoverableErrors).toHaveLength(0);
  });

  it('re-emits upstream meta.warnings as local recoverableErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'folder',
            id: 'drafts',
            attributes: {
              type: 'folder',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          },
          meta: {
            warnings: [
              { code: 'not_found', status: '404', title: 'Not Found', detail: 'parent missing' },
            ],
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.createFolder({ key: 'drafts' }));

    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('rejects with a LaikaError on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            errors: [{ code: 'invalid_data', status: '400', title: 'Invalid Data', detail: 'conflict' }],
          }),
          { status: 400, headers: { 'Content-Type': 'application/vnd.api+json' } },
        )
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await expect(
      LaikaTask.runPromiseCollect(proxy.createFolder({ key: 'bad' })),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});

// ─── getAtom ─────────────────────────────────────────────────────────────────

describe('StorageJsonApiProxyRepository.getAtom', () => {
  it('returns a StorageObject when the key resolves to an object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            type: 'object',
            id: 'notes/hello',
            attributes: {
              type: 'object',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              content: {},
            },
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getAtom('notes/hello'));

    expect(collected.value.key).toBe('notes/hello');
    expect(collected.value.type).toBe('object');
  });

  it('falls back to getFolder when getObject fails, returning the Folder', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname.startsWith('/objects/')) {
        return new Response(
          JSON.stringify({ errors: [{ code: 'not_found', status: '404', title: 'NF', detail: 'not an object' }] }),
          { status: 404, headers: { 'Content-Type': 'application/vnd.api+json' } },
        );
      }
      return jsonResponse({
        data: {
          type: 'folder',
          id: 'notes',
          attributes: {
            type: 'folder',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const collected = await LaikaTask.runPromiseCollect(proxy.getAtom('notes'));

    expect(collected.value.key).toBe('notes');
    expect(collected.value.type).toBe('folder');
  });
});

// ─── getCapabilities ──────────────────────────────────────────────────────────

describe('StorageJsonApiProxyRepository.getCapabilities', () => {
  it('returns capabilities decoded from GET /capabilities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            attributes: {
              compatibilityDate: '2026-05-11',
              fileExtensions: { supported: true, description: 'handled locally' },
              pagination: {
                supported: true,
                description: 'offset',
                styles: { offset: true, page: false, cursor: false },
              },
            },
          },
        })
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const { value } = await LaikaTask.runPromiseCollect(proxy.getCapabilities());

    expect(value.fileExtensions.supported).toBe(true);
    expect(value.pagination.supported).toBe(true);
  });

  it('caches the result so fetch is called only once across two invocations', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          attributes: {
            compatibilityDate: '2026-05-11',
            fileExtensions: { supported: false, description: 'remote' },
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

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    await LaikaTask.runPromiseCollect(proxy.getCapabilities());
    await LaikaTask.runPromiseCollect(proxy.getCapabilities());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the conservative default when the upstream returns an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ errors: [{ code: 'not_found', status: '404', title: 'NF', detail: 'no cap endpoint' }] }),
          { status: 404, headers: { 'Content-Type': 'application/vnd.api+json' } },
        )
      ),
    );

    const proxy = new StorageJsonApiProxyRepository({ baseUrl: 'http://upstream' });
    const { value } = await LaikaTask.runPromiseCollect(proxy.getCapabilities());

    // Conservative default: pagination supported, file extensions delegated to remote
    expect(value.pagination.supported).toBe(true);
    expect(value.fileExtensions.supported).toBe(false);
  });
});
