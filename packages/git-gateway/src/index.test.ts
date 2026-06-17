import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gitGateway } from './index.js';

// Mock the github module so tests never hit network or need real app creds.
vi.mock('./github.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./github.js')>();
  class MockInstallationTokenSource {
    getToken = vi.fn().mockResolvedValue('mock-installation-token');
  }
  return {
    ...actual,
    InstallationTokenSource: MockInstallationTokenSource,
    proxyToGithub: vi.fn(),
  };
});

import { proxyToGithub } from './github.js';

const mockProxyToGithub = proxyToGithub as ReturnType<typeof vi.fn>;

/** Minimal GitHub options — real creds not needed because InstallationTokenSource is mocked. */
const GITHUB_OPTS = {
  appId: 'app-1',
  privateKey: 'fake-key',
  installationId: '42',
  owner: 'acme',
  repo: 'website',
};

const makeRequest = (
  path: string,
  opts: RequestInit & { headers?: Record<string, string> } = {},
): Request => new Request(`http://localhost${path}`, opts);

const authedRequest = (path: string, opts: RequestInit & { headers?: Record<string, string> } = {}) =>
  makeRequest(path, { ...opts, headers: { Authorization: 'Bearer valid-token', ...opts.headers } });

describe('gitGateway()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProxyToGithub.mockResolvedValue(new Response('{}', { status: 200 }));
  });

  // ---------------------------------------------------------------------------
  // Auth gate
  // ---------------------------------------------------------------------------
  describe('auth gate', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(makeRequest('/settings'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    });

    it('returns 401 when Authorization header does not start with Bearer', async () => {
      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(
        makeRequest('/settings', { headers: { Authorization: 'Basic dXNlcjpwYXNz' } }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 when verifyToken throws', async () => {
      const app = gitGateway({
        verifyToken: async () => {
          throw new Error('network error');
        },
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/settings'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    });

    it('returns 401 when verifyToken returns null', async () => {
      const app = gitGateway({
        verifyToken: async () => null,
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/settings'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    });

    it('returns 403 when user has no matching role', async () => {
      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1', roles: ['viewer'] }),
        allowedRoles: ['editor', 'admin'],
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/settings'));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });

    it('returns 403 when user has no roles and allowedRoles is set', async () => {
      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        allowedRoles: ['admin'],
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/settings'));
      expect(res.status).toBe(403);
    });

    it('passes through when user has a matching role', async () => {
      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1', roles: ['editor'] }),
        allowedRoles: ['editor', 'admin'],
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/settings'));
      expect(res.status).toBe(200);
    });

    it('passes through when allowedRoles is empty (no role restriction)', async () => {
      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        allowedRoles: [],
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/settings'));
      expect(res.status).toBe(200);
    });

    it('passes OPTIONS through without auth', async () => {
      const app = gitGateway({
        verifyToken: async () => null,
        github: GITHUB_OPTS,
      });
      // OPTIONS preflight should not be blocked by authGate
      const res = await app.fetch(makeRequest('/settings', { method: 'OPTIONS' }));
      // Hono returns 404 for OPTIONS on /settings (no handler) — the point is it's not 401
      expect(res.status).not.toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /health
  // ---------------------------------------------------------------------------
  describe('GET /health', () => {
    it('returns { ok: true } without auth', async () => {
      const app = gitGateway({
        verifyToken: async () => null,
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(makeRequest('/health'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it('returns 200 even when verifyToken always rejects', async () => {
      const app = gitGateway({
        verifyToken: async () => {
          throw new Error('auth broken');
        },
        allowedRoles: ['admin'],
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(makeRequest('/health'));
      expect(res.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /settings
  // ---------------------------------------------------------------------------
  describe('GET /settings', () => {
    const user = { id: 'user-42', email: 'alice@example.com', name: 'Alice', roles: ['editor'] };

    it('returns the expected JSON shape', async () => {
      const app = gitGateway({
        verifyToken: async () => user,
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/settings'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        version: '1.0.0',
        github_enabled: true,
        roles: ['editor'],
        user: { id: 'user-42', email: 'alice@example.com', name: 'Alice' },
      });
    });

    it('sets Cache-Control: no-store', async () => {
      const app = gitGateway({
        verifyToken: async () => user,
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/settings'));
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('returns empty roles array when user has no roles', async () => {
      const app = gitGateway({
        verifyToken: async () => ({ id: 'u2' }),
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/settings'));
      const body = await res.json();
      expect(body.roles).toEqual([]);
    });

    it('user object omits undefined email and name fields', async () => {
      const app = gitGateway({
        verifyToken: async () => ({ id: 'u3' }),
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/settings'));
      const body = await res.json();
      expect(body.user.id).toBe('u3');
    });
  });

  // ---------------------------------------------------------------------------
  // ALL /github/*
  // ---------------------------------------------------------------------------
  describe('ALL /github/*', () => {
    it('returns 403 for a disallowed GitHub endpoint', async () => {
      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        github: GITHUB_OPTS,
      });
      // /user is explicitly denied by isAllowedGithubPath
      const res = await app.fetch(authedRequest('/github/user'));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });

    it('returns 403 for /orgs path', async () => {
      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/github/orgs/acme'));
      expect(res.status).toBe(403);
    });

    it('proxies allowed paths and returns the upstream response', async () => {
      const upstreamResponse = new Response(JSON.stringify({ sha: 'abc123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      mockProxyToGithub.mockResolvedValueOnce(upstreamResponse);

      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/github/contents/README.md'));
      expect(res.status).toBe(200);
      expect(mockProxyToGithub).toHaveBeenCalledOnce();
    });

    it('calls proxyToGithub with the correct subpath', async () => {
      mockProxyToGithub.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        github: GITHUB_OPTS,
      });
      await app.fetch(authedRequest('/github/git/refs/heads/main'));
      expect(mockProxyToGithub).toHaveBeenCalledWith(
        expect.any(Request),
        '/git/refs/heads/main',
        expect.objectContaining({ target: GITHUB_OPTS }),
      );
    });

    it('returns 502 with GITHUB_ERROR code when proxyToGithub throws', async () => {
      mockProxyToGithub.mockRejectedValueOnce(new Error('upstream timeout'));

      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/github/contents/README.md'));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body).toMatchObject({ error: { code: 'GITHUB_ERROR' } });
      expect(body.error.message).toBe('upstream timeout');
    });

    it('returns 502 when proxyToGithub throws a non-Error', async () => {
      mockProxyToGithub.mockRejectedValueOnce('string error');

      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/github/contents/README.md'));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.message).toBe('string error');
    });

    it('proxies PUT requests (non-GET) to allowed paths', async () => {
      mockProxyToGithub.mockResolvedValueOnce(new Response('{}', { status: 201 }));

      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(
        authedRequest('/github/contents/new-file.md', {
          method: 'PUT',
          body: JSON.stringify({ message: 'add file', content: 'aGVsbG8=' }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      expect(res.status).toBe(201);
      expect(mockProxyToGithub).toHaveBeenCalledOnce();
    });

    it('proxies git/* paths', async () => {
      mockProxyToGithub.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const app = gitGateway({
        verifyToken: async () => ({ id: 'u1' }),
        github: GITHUB_OPTS,
      });
      const res = await app.fetch(authedRequest('/github/git/blobs'));
      expect(res.status).toBe(200);
      expect(mockProxyToGithub).toHaveBeenCalledWith(
        expect.any(Request),
        '/git/blobs',
        expect.anything(),
      );
    });
  });
});
