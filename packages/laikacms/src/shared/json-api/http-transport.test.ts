import { afterEach, describe, expect, it, vi } from 'vitest';

import * as Effect from 'effect/Effect';

import { InvalidData, NotFoundError } from 'laikacms/core';

import { StorageJsonApiProxyRepository } from '../../impl/storage-jsonapi-proxy/storage-jsonapi-proxy-repository.js';
import { LaikaTask } from '../core/index.js';
import { httpClientFromFetch, JsonApiHttpTransport } from './http-transport.js';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpClientFromFetch', () => {
  it('routes requests through the injected fetch, not globalThis.fetch', async () => {
    const globalFetch = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', globalFetch);
    const injectedFetch = vi.fn(async () => jsonResponse({ data: { id: 'x', attributes: { ok: true } } }));

    const transport = new JsonApiHttpTransport({
      baseUrl: 'http://upstream',
      httpClient: httpClientFromFetch(injectedFetch as unknown as typeof globalThis.fetch),
    });
    const json = await Effect.runPromise(transport.fetchJson('/things/x'));

    expect(injectedFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
    expect((json.data as { id: string }).id).toBe('x');
  });

  it('is accepted by a proxy repository via the httpClient option', async () => {
    const globalFetch = vi.fn(async () => jsonResponse({ data: null }));
    vi.stubGlobal('fetch', globalFetch);
    const injectedFetch = vi.fn(async () =>
      jsonResponse({
        data: {
          type: 'object',
          id: 'notes/a',
          attributes: {
            type: 'object',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            content: {},
          },
        },
      })
    );

    const proxy = new StorageJsonApiProxyRepository({
      baseUrl: 'http://upstream',
      httpClient: httpClientFromFetch(injectedFetch as unknown as typeof globalThis.fetch),
    });
    const object = await LaikaTask.runPromise(proxy.getObject('notes/a'));

    expect(object.key).toBe('notes/a');
    expect(injectedFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe('JsonApiHttpTransport.fetchJson', () => {
  it('resolves globalThis.fetch at request time so per-test stubs apply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { id: 'late-stub' } })));
    const transport = new JsonApiHttpTransport({ baseUrl: 'http://upstream' });
    const json = await Effect.runPromise(transport.fetchJson('/things/late'));
    expect((json.data as { id: string }).id).toBe('late-stub');
  });

  it('rehydrates upstream error codes into typed LaikaErrors when enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { errors: [{ code: 'not_found', status: '404', title: 'Not Found', detail: 'nope' }] },
          404,
        )
      ),
    );
    const transport = new JsonApiHttpTransport({ baseUrl: 'http://upstream' });
    await expect(
      Effect.runPromise(transport.fetchJson('/things/missing', { method: 'GET' }, { rehydrateErrorCodes: true })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sends the refreshed bearer token from tokenPromise on every request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new JsonApiHttpTransport({
      baseUrl: 'http://upstream',
      tokenPromise: async () => 'fresh-token',
    });
    await Effect.runPromise(transport.fetchJson('/things'));

    const headers = (fetchMock.mock.calls[0] as unknown as [unknown, { headers: Record<string, string> }])[1].headers;
    expect(new Headers(headers as HeadersInit).get('authorization')).toBe('Bearer fresh-token');
  });

  it('returns InvalidData with content-type and body snippet for non-JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<!DOCTYPE html><h1>Gateway Error</h1>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        })
      ),
    );
    const transport = new JsonApiHttpTransport({ baseUrl: 'http://upstream' });
    const err = await Effect.runPromise(transport.fetchJson('/things/x')).catch(e => e);
    expect(err).toBeInstanceOf(InvalidData);
    expect((err as InvalidData).message).toContain('text/html');
    expect((err as InvalidData).message).toContain('Gateway Error');
  });

  it('uses the custom networkError mapper for transport-level failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('DNS lookup failed');
      }),
    );
    const customMapper = vi.fn((_msg: string) => new InvalidData('custom-network-error'));
    const transport = new JsonApiHttpTransport({
      baseUrl: 'http://upstream',
      networkError: customMapper,
    });
    const err = await Effect.runPromise(transport.fetchJson('/things')).catch(e => e);
    expect(customMapper).toHaveBeenCalled();
    expect((err as InvalidData).message).toBe('custom-network-error');
  });

  it('sends static authToken as Authorization header on every request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new JsonApiHttpTransport({
      baseUrl: 'http://upstream',
      authToken: 'my-static-token',
    });
    await Effect.runPromise(transport.fetchJson('/things'));

    const headers = (fetchMock.mock.calls[0] as unknown as [unknown, { headers: Record<string, string> }])[1].headers;
    expect(new Headers(headers as HeadersInit).get('authorization')).toBe('Bearer my-static-token');
  });

  it('omits Authorization header when neither authToken nor tokenPromise is set', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new JsonApiHttpTransport({ baseUrl: 'http://upstream' });
    await Effect.runPromise(transport.fetchJson('/things'));

    const headers = (fetchMock.mock.calls[0] as unknown as [unknown, { headers: Record<string, string> }])[1].headers;
    expect(new Headers(headers as HeadersInit).get('authorization')).toBeNull();
  });

  it('multipart body sends FormData without json:api Content-Type override', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new JsonApiHttpTransport({ baseUrl: 'http://upstream' });
    const form = new FormData();
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
    await Effect.runPromise(transport.request('/upload', { method: 'POST', multipart: form }));

    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    // body should be FormData (or a string serialization), not a JSON string
    expect(init.body).not.toEqual(JSON.stringify(form));
    // Content-Type should not be explicitly set to json:api (the runtime sets the multipart boundary)
    const ct = new Headers(init.headers as HeadersInit).get('content-type');
    expect(ct).not.toBe('application/vnd.api+json');
  });
});
