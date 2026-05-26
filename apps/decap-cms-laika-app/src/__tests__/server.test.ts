import { describe, expect, it, vi } from 'vitest';

import app from '../server/index';

function envWithAssets(): { ASSETS: Fetcher, GITHUB_OAUTH_CLIENT_ID: string, GITHUB_OAUTH_CLIENT_SECRET: string } {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response('asset', { status: 200 })) } as unknown as Fetcher,
    GITHUB_OAUTH_CLIENT_ID: 'test-id',
    GITHUB_OAUTH_CLIENT_SECRET: 'test-secret',
  };
}

describe('decap-cms-laika-app worker', () => {
  it('answers /api/health', async () => {
    const res = await app.fetch(new Request('http://localhost/api/health'), envWithAssets());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, app: 'decap-cms-laika-app' });
  });

  it('redirects /auth to GitHub authorize with our client id', async () => {
    const res = await app.fetch(new Request('http://localhost/auth?scope=repo'), envWithAssets());
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('github.com/login/oauth/authorize');
    expect(location).toContain('client_id=test-id');
    expect(location).toContain('scope=repo');
    expect(location).toContain('redirect_uri=http%3A%2F%2Flocalhost%2Fauth%2Fcallback');
  });

  it('400s the /auth/callback when no code is provided', async () => {
    const res = await app.fetch(new Request('http://localhost/auth/callback'), envWithAssets());
    expect(res.status).toBe(400);
  });

  it('falls through unknown paths to the ASSETS binding', async () => {
    const env = envWithAssets();
    const res = await app.fetch(new Request('http://localhost/some/spa/route'), env);
    expect(res.status).toBe(200);
    expect(env.ASSETS.fetch).toHaveBeenCalled();
  });
});
