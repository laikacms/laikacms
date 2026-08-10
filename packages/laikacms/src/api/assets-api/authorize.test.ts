import type { AssetsRepository, Resource } from 'laikacms/assets';
import { describe, expect, it, vi } from 'vitest';
import { allowAll } from '../../shared/json-api/authorize.js';

import { AuthenticationError, ForbiddenError, LaikaTask, NotFoundError } from 'laikacms/core';

import { type AssetsAuthorizeInput, buildAssetsApi } from './server.js';

// ---------------------------------------------------------------------------
// Minimal repository stubs for authorize tests
// ---------------------------------------------------------------------------

const makeAsset = (key: string): Resource => ({
  type: 'asset',
  key,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  content: { size: 1, etag: key },
});

const readonlyRepo: Partial<AssetsRepository> = {
  getCapabilities: () =>
    LaikaTask.succeed({
      compatibilityDate: '2026-01-01' as never,
      pagination: { supported: true, description: '', styles: { offset: true, page: true, cursor: false } },
      versionTracking: { supported: false, description: '' },
      changes: { supported: false, description: '' },
    }),
  listResources: () => LaikaTask.succeed([] as never),
  getResource: (_key: string) => LaikaTask.succeed([makeAsset(_key)] as never),
  createAsset: () => LaikaTask.succeed(makeAsset('new.png') as never),
  createFolder: () => LaikaTask.succeed({ type: 'folder', key: 'new/', createdAt: '', updatedAt: '' } as never),
  updateAsset: () => LaikaTask.succeed(makeAsset('updated.png') as never),
  deleteAsset: () => LaikaTask.succeed(undefined as never),
};

// ---------------------------------------------------------------------------
// allowAll → the explicit opt-out for a deliberately open surface
// ---------------------------------------------------------------------------

describe('assets-api authorize — allowAll (LCMS-519)', () => {
  it('serves every action when the policy is the allowAll sentinel', async () => {
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/api/assets/capabilities'));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// authorize returns true → allow
// ---------------------------------------------------------------------------

describe('assets-api authorize — true allows (LCMS-519)', () => {
  it('allows GET /capabilities when callback returns true', async () => {
    const authorize = vi.fn(async (_input: AssetsAuthorizeInput) => true as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(new Request('http://localhost/api/assets/capabilities'));
    expect(res.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'getCapabilities' }));
  });

  it('allows GET /resources when callback returns true', async () => {
    const authorize = vi.fn(async (_input: AssetsAuthorizeInput) => true as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources'));
    expect(res.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'listResources', folder: '' }));
  });

  it('allows GET /resources/:key when callback returns true', async () => {
    const authorize = vi.fn(async (_input: AssetsAuthorizeInput) => true as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources/photo.jpg'));
    expect(res.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'getResource', key: 'photo.jpg' }));
  });

  it('passes the originating Request to the callback', async () => {
    const authorize = vi.fn(async (_input: AssetsAuthorizeInput) => true as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const req = new Request('http://localhost/api/assets/capabilities', {
      headers: { Authorization: 'Bearer tok' },
    });
    await api.fetch(req);
    const call = authorize.mock.calls[0]?.[0];
    expect(call?.request).toBe(req);
  });
});

// ---------------------------------------------------------------------------
// authorize returns false → 403 ForbiddenError
// ---------------------------------------------------------------------------

describe('assets-api authorize — false → 403 (LCMS-519)', () => {
  it('returns 403 for GET /capabilities when callback returns false', async () => {
    const authorize = vi.fn(async () => false as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(new Request('http://localhost/api/assets/capabilities'));
    expect(res.status).toBe(403);
    const body = await res.json() as { errors: Array<{ code: string }> };
    expect(body.errors[0]?.code).toBe('forbidden');
  });

  it('returns 403 for GET /resources when callback returns false', async () => {
    const authorize = vi.fn(async () => false as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources'));
    expect(res.status).toBe(403);
  });

  it('returns 403 for GET /resources/:key when callback returns false', async () => {
    const authorize = vi.fn(async () => false as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources/secret.jpg'));
    expect(res.status).toBe(403);
  });

  it('returns 403 for PATCH /resources/:key when callback returns false', async () => {
    const authorize = vi.fn(async () => false as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/photo.jpg', {
        method: 'PATCH',
        body: JSON.stringify({ data: { type: 'asset', id: 'photo.jpg', attributes: {} } }),
        headers: { 'Content-Type': 'application/vnd.api+json' },
      }),
    );
    expect(res.status).toBe(403);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'updateAsset', key: 'photo.jpg' }));
  });

  it('returns 403 for DELETE /resources/:key when callback returns false', async () => {
    const authorize = vi.fn(async () => false as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/photo.jpg', { method: 'DELETE' }),
    );
    expect(res.status).toBe(403);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleteResource', key: 'photo.jpg' }));
  });

  it('does not invoke repository when callback returns false', async () => {
    const getCapabilities = vi.fn();
    const repo = { ...readonlyRepo, getCapabilities } as unknown as AssetsRepository;
    const api = buildAssetsApi({ repository: repo, authorize: async () => false });
    await api.fetch(new Request('http://localhost/api/assets/capabilities'));
    expect(getCapabilities).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// authorize returns LaikaError → correct HTTP status
// ---------------------------------------------------------------------------

describe('assets-api authorize — LaikaError → custom status (LCMS-519)', () => {
  it('returns 401 when callback returns AuthenticationError', async () => {
    const authorize = vi.fn(async () => new AuthenticationError('Missing token'));
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources'));
    expect(res.status).toBe(401);
    const body = await res.json() as { errors: Array<{ code: string }> };
    expect(body.errors[0]?.code).toBe('unauthenticated');
  });

  it('returns 403 when callback returns ForbiddenError', async () => {
    const authorize = vi.fn(async () => new ForbiddenError('No access'));
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources/img.jpg'));
    expect(res.status).toBe(403);
    const body = await res.json() as { errors: Array<{ code: string, detail: string }> };
    expect(body.errors[0]?.code).toBe('forbidden');
    expect(body.errors[0]?.detail).toBe('No access');
  });

  it('returns 404 when callback returns NotFoundError', async () => {
    const authorize = vi.fn(async () => new NotFoundError('Tenant not found'));
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(new Request('http://localhost/api/assets/capabilities'));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /resources — createAsset and createFolder actions
// ---------------------------------------------------------------------------

describe('assets-api authorize — create actions (LCMS-519)', () => {
  it('invokes callback with createFolder before creating a folder', async () => {
    const authorize = vi.fn(async () => true as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources', {
        method: 'POST',
        body: JSON.stringify({ data: { type: 'folder', id: 'images/', attributes: {} } }),
        headers: { 'Content-Type': 'application/vnd.api+json' },
      }),
    );
    expect(res.status).toBe(201);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'createFolder' }));
  });

  it('returns 403 for createFolder when callback returns false', async () => {
    const authorize = vi.fn(async (input: AssetsAuthorizeInput) => input.action === 'createFolder' ? false : true);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources', {
        method: 'POST',
        body: JSON.stringify({ data: { type: 'folder', id: 'images/', attributes: {} } }),
        headers: { 'Content-Type': 'application/vnd.api+json' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('invokes callback with createAsset for JSON asset creation', async () => {
    const authorize = vi.fn(async () => true as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });
    const content = btoa('fake binary');
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources', {
        method: 'POST',
        body: JSON.stringify({
          data: { type: 'asset', id: 'test.png', attributes: { mimeType: 'image/png', content } },
        }),
        headers: { 'Content-Type': 'application/vnd.api+json' },
      }),
    );
    expect(res.status).toBe(201);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'createAsset' }));
  });
});

describe('assets-api authorize — OpenAPI routes (LCMS-519)', () => {
  it('authorizes the OpenAPI document like any other action', async () => {
    const authorize = vi.fn(async (_input: AssetsAuthorizeInput) => true as const);
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize });

    const res = await api.fetch(new Request('http://localhost/api/assets/openapi.json'));

    expect(res.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'readOpenApi', format: 'json' }),
    );
  });

  it('does not serve the spec to a caller a deny-all policy rejects', async () => {
    const api = buildAssetsApi({ repository: readonlyRepo as AssetsRepository, authorize: () => false });

    for (const format of ['json', 'yaml'] as const) {
      const res = await api.fetch(new Request(`http://localhost/api/assets/openapi.${format}`));
      expect(res.status).toBe(403);
    }
  });
});
