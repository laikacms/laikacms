import { afterEach, describe, expect, it, vi } from 'vitest';

import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';

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
