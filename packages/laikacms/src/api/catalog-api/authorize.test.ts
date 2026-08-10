import { describe, expect, it, vi } from 'vitest';

import type { Catalog, CatalogProvider } from 'laikacms/catalog';
import { AuthenticationError, LaikaTask } from 'laikacms/core';

import { buildJsonApi, type CatalogAuthorizeInput } from './server.js';

const settings: Catalog = {
  collections: {
    posts: { type: 'document', key: 'posts', name: 'Posts' },
  },
};

function spyRepo() {
  const getCatalog = vi.fn(() => LaikaTask.succeed(settings));
  const getDocumentCollectionSettings = vi.fn((_key: string) => LaikaTask.succeed(settings.collections!.posts));
  const putCatalog = vi.fn(() => LaikaTask.succeed(undefined));
  const repo = {
    getCatalog,
    getDocumentCollectionSettings,
    putCatalog,
  } as unknown as CatalogProvider;
  return { repo, getCatalog, putCatalog };
}

describe('catalog-api authorize hook', () => {
  it('allows the action and forwards it to the repo when the callback returns true', async () => {
    const { repo, getCatalog } = spyRepo();
    const authorize = vi.fn(() => true);
    const api = buildJsonApi({ repo, authorize });

    const res = await api.fetch(new Request('http://localhost/collections'));

    expect(res.status).toBe(200);
    expect(getCatalog).toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it('passes the action, direct args, and the request to the callback', async () => {
    const { repo } = spyRepo();
    let received: CatalogAuthorizeInput | undefined;
    const request = new Request('http://localhost/collections/posts');
    const api = buildJsonApi({
      repo,
      authorize: input => {
        received = input;
        return true;
      },
    });

    await api.fetch(request);

    expect(received?.action).toBe('getCollection');
    expect(received && 'key' in received ? received.key : undefined).toBe('posts');
    // Hono exposes the underlying Request as c.req.raw.
    expect(received?.request).toBeInstanceOf(Request);
    expect(received?.request.url).toBe(request.url);
  });

  it('denies with a 403 (and never touches the repo) when the callback returns false', async () => {
    const { repo, getCatalog } = spyRepo();
    const api = buildJsonApi({ repo, authorize: () => false });

    const res = await api.fetch(new Request('http://localhost/collections/posts'));

    expect(res.status).toBe(403);
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it('denies with the callback-supplied LaikaError status (e.g. 401)', async () => {
    const { repo, getCatalog } = spyRepo();
    const api = buildJsonApi({
      repo,
      authorize: () => new AuthenticationError('Missing bearer token'),
    });

    const res = await api.fetch(new Request('http://localhost/collections/posts'));

    expect(res.status).toBe(401);
    expect(getCatalog).not.toHaveBeenCalled();
    const body = await res.json() as { errors: Array<{ detail: string }> };
    expect(body.errors[0]?.detail).toBe('Missing bearer token');
  });

  it('denies a delete before any write when the callback returns false', async () => {
    const { repo, getCatalog, putCatalog } = spyRepo();
    const api = buildJsonApi({ repo, authorize: () => false });

    const res = await api.fetch(
      new Request('http://localhost/collections/posts', { method: 'DELETE' }),
    );

    expect(res.status).toBe(403);
    expect(getCatalog).not.toHaveBeenCalled();
    expect(putCatalog).not.toHaveBeenCalled();
  });
});

describe('catalog-api authorize hook — OpenAPI routes', () => {
  it('authorizes the OpenAPI document like any other action', async () => {
    const { repo } = spyRepo();
    const authorize = vi.fn(() => true);
    const api = buildJsonApi({ repo, authorize });

    const res = await api.fetch(new Request('http://localhost/openapi.json'));

    expect(res.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'readOpenApi', format: 'json' }),
    );
  });

  it('does not serve the spec to a caller a deny-all policy rejects', async () => {
    const { repo } = spyRepo();
    const api = buildJsonApi({ repo, authorize: () => false });

    for (const format of ['json', 'yaml'] as const) {
      const res = await api.fetch(new Request(`http://localhost/openapi.${format}`));
      expect(res.status).toBe(403);
    }
  });

  it('reports the requested serialization so a policy can allow one and deny the other', async () => {
    const { repo } = spyRepo();
    const api = buildJsonApi({
      repo,
      authorize: input => input.action === 'readOpenApi' && input.format === 'json',
    });

    expect((await api.fetch(new Request('http://localhost/openapi.json'))).status).toBe(200);
    expect((await api.fetch(new Request('http://localhost/openapi.yaml'))).status).toBe(403);
  });
});
