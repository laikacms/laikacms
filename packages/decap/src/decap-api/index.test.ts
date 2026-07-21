/**
 * Unit tests for decap-api/index.ts — auth router
 *
 * Covers:
 *   - SECURITY_DEFAULTS.MAX_TOKEN_LENGTH constant
 *   - validateTokenInput behaviour (tested indirectly via authenticateRequest)
 *   - authenticateRequest: API key path vs Bearer path vs no-auth → 401
 *   - GET /health → 200 without auth
 *   - GET /session → 200 with user identity, strips passwordHash
 *   - URL query-string api_key is rejected / ignored
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetsCapabilities, AssetsRepository } from 'laikacms/assets';
import { LaikaTask } from 'laikacms/core';
import type { DocumentsCapabilities, DocumentsRepository } from 'laikacms/documents';
import type { Capabilities, StorageRepository } from 'laikacms/storage';

import { decapApi, SECURITY_DEFAULTS } from './index.js';
import type { DecapOptions, User } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'https://example.com';

function makeRequest(path: string, headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request(`${BASE_URL}${path}`, { method, headers });
}

const MOCK_USER: User = { id: 'u1', email: 'test@example.com', name: 'Test User' };

function makeOptions(overrides: Partial<DecapOptions> = {}): DecapOptions {
  return {
    documents: {} as DecapOptions['documents'],
    storage: {} as DecapOptions['storage'],
    authenticateAccessToken: vi.fn().mockResolvedValue(MOCK_USER),
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: SECURITY_DEFAULTS
// ---------------------------------------------------------------------------

describe('SECURITY_DEFAULTS', () => {
  it('MAX_TOKEN_LENGTH is 2048', () => {
    expect(SECURITY_DEFAULTS.MAX_TOKEN_LENGTH).toBe(2048);
  });

  it('MAX_API_KEY_LENGTH is 512', () => {
    expect(SECURITY_DEFAULTS.MAX_API_KEY_LENGTH).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// Suite: GET /health — no authentication required
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('responds 200 without any authentication header', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(makeRequest('/health'));

    expect(res.status).toBe(200);
  });

  it('response body contains { status: "ok" }', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(makeRequest('/health'));
    const body = await res.json();

    expect(body).toMatchObject({ status: 'ok' });
  });

  it('does NOT call authenticateAccessToken for /health', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken }));

    await api.fetch(makeRequest('/health'));

    expect(authenticateAccessToken).not.toHaveBeenCalled();
  });

  it('includes a timestamp in the response', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(makeRequest('/health'));
    const body = await res.json();

    expect(typeof body.timestamp).toBe('string');
    expect(() => new Date(body.timestamp)).not.toThrow();
  });

  it('uses Content-Type: application/json (not application/vnd.api+json)', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(makeRequest('/health'));

    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Content-Type')).not.toContain('vnd.api+json');
  });
});

// ---------------------------------------------------------------------------
// Suite: validateTokenInput — tested via authenticateRequest
//
// validateTokenInput is unexported; we probe it by observing which raw token
// values actually reach authenticateAccessToken vs which ones trigger a 401.
// ---------------------------------------------------------------------------

describe('validateTokenInput (via authenticateRequest)', () => {
  it('passes a valid short token through to authenticateAccessToken', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken }));

    const result = await api.authenticateRequest(
      makeRequest('/documents', { Authorization: 'Bearer valid-token' }),
    );

    expect(result).not.toBeInstanceOf(Response);
    expect(authenticateAccessToken).toHaveBeenCalledWith('valid-token');
  });

  it('returns 401 for a null/missing Authorization header (simulates null token input)', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken }));

    const result = await api.authenticateRequest(makeRequest('/documents'));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(authenticateAccessToken).not.toHaveBeenCalled();
  });

  it('returns 401 for an empty Bearer value (simulates empty string token input)', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken }));

    // "Bearer " with trailing space — ExtractAuthorizationBearerToken won't match regex
    const result = await api.authenticateRequest(
      makeRequest('/documents', { Authorization: 'Bearer ' }),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(authenticateAccessToken).not.toHaveBeenCalled();
  });

  it('returns 401 for a Bearer token exceeding MAX_TOKEN_LENGTH (2048 chars)', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken }));
    const longToken = 'a'.repeat(SECURITY_DEFAULTS.MAX_TOKEN_LENGTH + 1);

    const result = await api.authenticateRequest(
      makeRequest('/documents', { Authorization: `Bearer ${longToken}` }),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(authenticateAccessToken).not.toHaveBeenCalled();
  });

  it('accepts a Bearer token of exactly MAX_TOKEN_LENGTH chars', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken }));
    // Use base64-safe chars so the Bearer regex matches
    const exactToken = 'a'.repeat(SECURITY_DEFAULTS.MAX_TOKEN_LENGTH);

    const result = await api.authenticateRequest(
      makeRequest('/documents', { Authorization: `Bearer ${exactToken}` }),
    );

    // Should NOT be a Response (auth passed through)
    expect(result).not.toBeInstanceOf(Response);
    expect(authenticateAccessToken).toHaveBeenCalledWith(exactToken);
  });

  it('returns 401 for an API key exceeding MAX_TOKEN_LENGTH', async () => {
    const authenticateApiToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateApiToken }));
    const longKey = 'k'.repeat(SECURITY_DEFAULTS.MAX_TOKEN_LENGTH + 1);

    const result = await api.authenticateRequest(
      makeRequest('/documents', { 'X-API-Key': longKey }),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(authenticateApiToken).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: authenticateRequest — API key path
// ---------------------------------------------------------------------------

describe('authenticateRequest — API key (X-API-Key header)', () => {
  it('calls authenticateApiToken (not authenticateAccessToken) when X-API-Key is present', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const authenticateApiToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken, authenticateApiToken }));

    const result = await api.authenticateRequest(
      makeRequest('/documents', { 'X-API-Key': 'my-api-key' }),
    );

    expect(result).not.toBeInstanceOf(Response);
    expect(authenticateApiToken).toHaveBeenCalledWith('my-api-key');
    expect(authenticateAccessToken).not.toHaveBeenCalled();
  });

  it('returns 401 when API key provided but authenticateApiToken not configured', async () => {
    const api = decapApi(makeOptions({ authenticateApiToken: undefined }));

    const result = await api.authenticateRequest(
      makeRequest('/documents', { 'X-API-Key': 'my-api-key' }),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('calls authenticateApiToken when Authorization: ApiKey <key> header is used', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const authenticateApiToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken, authenticateApiToken }));

    const result = await api.authenticateRequest(
      makeRequest('/documents', { Authorization: 'ApiKey my-api-key' }),
    );

    expect(result).not.toBeInstanceOf(Response);
    expect(authenticateApiToken).toHaveBeenCalledWith('my-api-key');
    expect(authenticateAccessToken).not.toHaveBeenCalled();
  });

  it('returns the User object from authenticateApiToken on success', async () => {
    const apiUser: User = { id: 'api-user', email: 'api@example.com' };
    const api = decapApi(makeOptions({
      authenticateApiToken: vi.fn().mockResolvedValue(apiUser),
    }));

    const result = await api.authenticateRequest(
      makeRequest('/documents', { 'X-API-Key': 'good-key' }),
    );

    expect(result).toEqual(apiUser);
  });
});

// ---------------------------------------------------------------------------
// Suite: authenticateRequest — Bearer token path
// ---------------------------------------------------------------------------

describe('authenticateRequest — Bearer token', () => {
  it('calls authenticateAccessToken with the raw token', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken }));

    await api.authenticateRequest(
      makeRequest('/documents', { Authorization: 'Bearer my-secret-token' }),
    );

    expect(authenticateAccessToken).toHaveBeenCalledWith('my-secret-token');
  });

  it('returns the User on successful Bearer auth', async () => {
    const api = decapApi(makeOptions({
      authenticateAccessToken: vi.fn().mockResolvedValue(MOCK_USER),
    }));

    const result = await api.authenticateRequest(
      makeRequest('/documents', { Authorization: 'Bearer good-token' }),
    );

    expect(result).toEqual(MOCK_USER);
  });

  it('returns 401 Response when authenticateAccessToken rejects', async () => {
    const api = decapApi(makeOptions({
      authenticateAccessToken: vi.fn().mockRejectedValue(new Error('token expired')),
    }));

    const result = await api.authenticateRequest(
      makeRequest('/documents', { Authorization: 'Bearer expired-token' }),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite: authenticateRequest — no credentials
// ---------------------------------------------------------------------------

describe('authenticateRequest — no credentials', () => {
  it('returns a 401 Response when no Authorization header and no X-API-Key', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken }));

    const result = await api.authenticateRequest(makeRequest('/documents'));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('does NOT call authenticateAccessToken when no credentials are present', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken }));

    await api.authenticateRequest(makeRequest('/documents'));

    expect(authenticateAccessToken).not.toHaveBeenCalled();
  });

  it('401 response body is JSON:API error format', async () => {
    const api = decapApi(makeOptions());

    const result = await api.authenticateRequest(makeRequest('/documents'));
    const body = await (result as Response).json();

    expect(body).toHaveProperty('errors');
    expect(Array.isArray(body.errors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite: URL query string api_key is rejected
// ---------------------------------------------------------------------------

describe('URL query-string api_key', () => {
  it('logs a warning when api_key appears in the query string', async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const api = decapApi(makeOptions({ logger }));

    await api.authenticateRequest(
      new Request(`${BASE_URL}/documents?api_key=secret`),
    );

    expect(logger.warn).toHaveBeenCalled();
  });

  it('does NOT authenticate via query-string api_key (returns 401)', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const authenticateApiToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken, authenticateApiToken }));

    const result = await api.authenticateRequest(
      new Request(`${BASE_URL}/documents?api_key=secret`),
    );

    // Query-string key must never be honored — both auth fns skipped, 401 returned
    expect(authenticateApiToken).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('rejects explicitly even when a valid Bearer token is also present', async () => {
    // This test proves the 401 is an explicit rejection of ?api_key=, not an
    // accidental side-effect of missing credentials — a valid Bearer token does
    // NOT rescue a request that carries an api_key URL parameter.
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const authenticateApiToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({ authenticateAccessToken, authenticateApiToken }));

    const result = await api.authenticateRequest(
      new Request(`${BASE_URL}/documents?api_key=secret`, {
        headers: { Authorization: 'Bearer good-token' },
      }),
    );

    // Despite a valid Bearer header, the request must be rejected
    expect(authenticateAccessToken).not.toHaveBeenCalled();
    expect(authenticateApiToken).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite: GET /session — passes user identity downstream
// ---------------------------------------------------------------------------

describe('GET /session', () => {
  it('responds 200 for an authenticated request', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(
      makeRequest('/session', { Authorization: 'Bearer good-token' }),
    );

    expect(res.status).toBe(200);
  });

  it('response body contains the user id at resource level and email in attributes', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(
      makeRequest('/session', { Authorization: 'Bearer good-token' }),
    );
    const body = await res.json();

    expect(body.data.id).toBe(MOCK_USER.id);
    expect(body.data.attributes.email).toBe(MOCK_USER.email);
  });

  it('JSON:API §7.2.2 compliance — attributes must not contain id or type (LCMS-282)', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(
      makeRequest('/session', { Authorization: 'Bearer good-token' }),
    );
    const body = await res.json();

    expect(body.data.attributes).not.toHaveProperty('id');
    expect(body.data.attributes).not.toHaveProperty('type');
  });

  it('strips passwordHash from the /session response', async () => {
    const userWithHash: User = { ...MOCK_USER, passwordHash: 'super-secret-hash' };
    const api = decapApi(makeOptions({
      authenticateAccessToken: vi.fn().mockResolvedValue(userWithHash),
    }));

    const res = await api.fetch(
      makeRequest('/session', { Authorization: 'Bearer good-token' }),
    );
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain('super-secret-hash');
    expect(body.data.attributes).not.toHaveProperty('passwordHash');
  });

  it('returns 401 for /session without auth', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(makeRequest('/session'));

    expect(res.status).toBe(401);
  });

  it('uses Content-Type: application/json (not application/vnd.api+json) — LCMS-375', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(
      makeRequest('/session', { Authorization: 'Bearer good-token' }),
    );

    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Content-Type')).not.toContain('vnd.api+json');
  });
});

// ---------------------------------------------------------------------------
// Suite: unknown endpoints
// ---------------------------------------------------------------------------

describe('unknown endpoints', () => {
  it('returns 404 for unknown path after successful auth', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(
      makeRequest('/unknown-path', { Authorization: 'Bearer good-token' }),
    );

    expect(res.status).toBe(404);
  });

  it('returns 401 (not 404) for unknown path without auth', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(makeRequest('/unknown-path'));

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite: basePath option
// ---------------------------------------------------------------------------

describe('basePath option', () => {
  it('routes /health correctly when basePath is set', async () => {
    const api = decapApi(makeOptions({ basePath: '/api/v1' }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/api/v1/health`),
    );

    expect(res.status).toBe(200);
  });

  it('/health at root 404s when basePath is set', async () => {
    const api = decapApi(makeOptions({ basePath: '/api/v1' }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/health`, { headers: { Authorization: 'Bearer good-token' } }),
    );

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Suite: CORS — OPTIONS preflight and header injection
// ---------------------------------------------------------------------------

describe('cors option — OPTIONS preflight', () => {
  it('returns 204 for OPTIONS preflight from an allowed origin (no auth required)', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/session`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5000',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization',
        },
      }),
    );

    expect(res.status).toBe(204);
  });

  it('OPTIONS preflight carries Access-Control-Allow-Origin from the allowed origin', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/session`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5000', 'Access-Control-Request-Method': 'GET' },
      }),
    );

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5000');
  });

  it('OPTIONS preflight carries Access-Control-Allow-Methods', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/session`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5000', 'Access-Control-Request-Method': 'GET' },
      }),
    );

    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('OPTIONS preflight carries Access-Control-Allow-Headers', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/session`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5000', 'Access-Control-Request-Method': 'GET' },
      }),
    );

    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('does NOT call authenticateAccessToken for an OPTIONS preflight', async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(MOCK_USER);
    const api = decapApi(makeOptions({
      authenticateAccessToken,
      cors: { origins: ['http://localhost:5000'] },
    }));

    await api.fetch(
      new Request(`${BASE_URL}/session`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5000', 'Access-Control-Request-Method': 'GET' },
      }),
    );

    expect(authenticateAccessToken).not.toHaveBeenCalled();
  });

  it('OPTIONS from a disallowed origin passes through (no CORS headers, not 204)', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/session`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://evil.example.com', 'Access-Control-Request-Method': 'GET' },
      }),
    );

    // Not a CORS preflight response — falls through to normal routing (401 without auth)
    expect(res.status).not.toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('OPTIONS with cors: { origins: "*" } responds 204 for any origin', async () => {
    const api = decapApi(makeOptions({ cors: { origins: '*' } }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/health`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://any.example.com', 'Access-Control-Request-Method': 'GET' },
      }),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('Access-Control-Max-Age defaults to 86400', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/health`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5000', 'Access-Control-Request-Method': 'GET' },
      }),
    );

    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('Access-Control-Max-Age uses the configured maxAge', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'], maxAge: 300 } }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/health`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5000', 'Access-Control-Request-Method': 'GET' },
      }),
    );

    expect(res.headers.get('Access-Control-Max-Age')).toBe('300');
  });
});

describe('cors option — CORS headers on regular responses', () => {
  it('GET /health includes Access-Control-Allow-Origin when cors is configured', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      makeRequest('/health', { Origin: 'http://localhost:5000' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5000');
  });

  it('GET /session includes Access-Control-Allow-Origin when cors is configured', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      makeRequest('/session', {
        Authorization: 'Bearer good-token',
        Origin: 'http://localhost:5000',
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5000');
  });

  it('401 responses also include Access-Control-Allow-Origin (browser must read error body)', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      makeRequest('/session', { Origin: 'http://localhost:5000' }),
    );

    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5000');
  });

  it('responses from a disallowed origin carry no Access-Control-Allow-Origin', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      makeRequest('/health', { Origin: 'http://other.example.com' }),
    );

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('responses with no Origin header carry no Access-Control-Allow-Origin', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(makeRequest('/health'));

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('no cors option → no CORS headers on any response', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(
      makeRequest('/health', { Origin: 'http://localhost:5000' }),
    );

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('Vary: Origin is set when origins is an explicit list (not wildcard)', async () => {
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      makeRequest('/health', { Origin: 'http://localhost:5000' }),
    );

    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('Vary header is absent when origins is "*"', async () => {
    const api = decapApi(makeOptions({ cors: { origins: '*' } }));
    const res = await api.fetch(
      makeRequest('/health', { Origin: 'http://anywhere.example.com' }),
    );

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    // Vary: Origin is not meaningful with wildcard — browser caching not affected by origin
    expect(res.headers.get('Vary') ?? '').not.toContain('Origin');
  });

  it('CORS response body is intact after CORS headers are injected (LCMS-437)', async () => {
    // Regression: withHeaders() forwarded response.body (a ReadableStream) into a new
    // Response(), causing Node's HTTP layer to send Transfer-Encoding: chunked instead of
    // Content-Length. Chromium then aborted cross-origin /session requests with
    // ERR_CONTENT_LENGTH_MISMATCH, preventing the admin UI from authenticating.
    // Fix: buffer via arrayBuffer() so the body is known-size when serialised on the wire.
    // Here we verify the body is readable and correct after withHeaders() runs.
    const api = decapApi(makeOptions({ cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      makeRequest('/health', { Origin: 'http://localhost:5000' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5000');
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok' });
  });

  it('a 204 response survives the CORS path (LCMS-437)', async () => {
    // The buffering above must not turn a null body into an empty ArrayBuffer: a
    // null-body status rejects any body at all, so `new Response(new ArrayBuffer(0),
    // { status: 204 })` throws. A clean cross-origin asset DELETE returns exactly that
    // 204, which is why this is the assets path and not /health.
    const assets = {
      getResource: (key: string) =>
        LaikaTask.succeed([{
          type: 'asset' as const,
          key,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          content: { size: 4, etag: 'e' },
        }]),
      deleteAsset: (_key: string) => LaikaTask.succeed(undefined),
    } as unknown as AssetsRepository;

    const api = decapApi(makeOptions({ assets, cors: { origins: ['http://localhost:5000'] } }));
    const res = await api.fetch(
      makeRequest(
        '/assets/resources/pic.png',
        { Origin: 'http://localhost:5000', Authorization: 'Bearer tok' },
        'DELETE',
      ),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5000');
  });
});

// ---------------------------------------------------------------------------
// Suite: sub-API routing via api.fetch() — LCMS-305
//
// These tests verify that an authenticated request to /storage/*, /documents/*,
// or /assets/* is actually forwarded to the corresponding sub-API and that the
// sub-API's response reaches the caller. Each test uses a minimal stub repo
// that only implements getCapabilities() — enough for GET /capabilities.
// ---------------------------------------------------------------------------

const makeStorageCaps = (): Capabilities => ({
  compatibilityDate: '2026-01-01' as Capabilities['compatibilityDate'],
  fileExtensions: { supported: false, description: 'none' },
  pagination: { supported: false, description: 'none' },
});

const makeDocumentsCaps = (): DocumentsCapabilities => ({
  compatibilityDate: '2026-01-01' as DocumentsCapabilities['compatibilityDate'],
  pagination: { supported: false, description: 'none' },
});

const makeAssetsCaps = (): AssetsCapabilities => ({
  compatibilityDate: '2026-01-01' as AssetsCapabilities['compatibilityDate'],
  pagination: { supported: false, description: 'none' },
});

describe('sub-API routing — GET /storage/capabilities (LCMS-305)', () => {
  it('forwards an authenticated request to the storage sub-API and returns 200', async () => {
    const storageRepo = {
      getCapabilities: () => LaikaTask.succeed(makeStorageCaps()),
    } as unknown as StorageRepository;

    const api = decapApi(makeOptions({ storage: storageRepo }));
    const res = await api.fetch(makeRequest('/storage/capabilities', { Authorization: 'Bearer good-token' }));

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { type: string } };
    expect(body.data.type).toBe('storage-capabilities');
  });

  it('returns 401 (not a sub-API error) when the /storage/* request is unauthenticated', async () => {
    const storageRepo = {
      getCapabilities: () => LaikaTask.succeed(makeStorageCaps()),
    } as unknown as StorageRepository;

    const api = decapApi(makeOptions({ storage: storageRepo }));
    const res = await api.fetch(makeRequest('/storage/capabilities'));

    expect(res.status).toBe(401);
  });
});

describe('sub-API routing — GET /documents/capabilities (LCMS-305)', () => {
  it('forwards an authenticated request to the documents sub-API and returns 200', async () => {
    const documentsRepo = {
      getCapabilities: () => LaikaTask.succeed(makeDocumentsCaps()),
    } as unknown as DocumentsRepository;

    const api = decapApi(makeOptions({ documents: documentsRepo }));
    const res = await api.fetch(makeRequest('/documents/capabilities', { Authorization: 'Bearer good-token' }));

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { type: string } };
    expect(body.data.type).toBe('documents-capabilities');
  });

  it('returns 401 when the /documents/* request is unauthenticated', async () => {
    const documentsRepo = {
      getCapabilities: () => LaikaTask.succeed(makeDocumentsCaps()),
    } as unknown as DocumentsRepository;

    const api = decapApi(makeOptions({ documents: documentsRepo }));
    const res = await api.fetch(makeRequest('/documents/capabilities'));

    expect(res.status).toBe(401);
  });
});

describe('sub-API routing — GET /assets/capabilities (LCMS-305)', () => {
  it('forwards an authenticated request to the assets sub-API and returns 200', async () => {
    const assetsRepo = {
      getCapabilities: () => LaikaTask.succeed(makeAssetsCaps()),
    } as unknown as AssetsRepository;

    const api = decapApi(makeOptions({ assets: assetsRepo }));
    const res = await api.fetch(makeRequest('/assets/capabilities', { Authorization: 'Bearer good-token' }));

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { type: string } };
    expect(body.data.type).toBe('assets-capabilities');
  });

  it('returns 401 when the /assets/* request is unauthenticated', async () => {
    const assetsRepo = {
      getCapabilities: () => LaikaTask.succeed(makeAssetsCaps()),
    } as unknown as AssetsRepository;

    const api = decapApi(makeOptions({ assets: assetsRepo }));
    const res = await api.fetch(makeRequest('/assets/capabilities'));

    expect(res.status).toBe(401);
  });

  it('returns 404 when assets repo is not configured and /assets/* is requested', async () => {
    // No assets repo passed → assets routing is disabled
    const api = decapApi(makeOptions({ assets: undefined }));
    const res = await api.fetch(makeRequest('/assets/capabilities', { Authorization: 'Bearer good-token' }));

    expect(res.status).toBe(404);
  });
});

describe('sub-API routing — basePath propagation (LCMS-305)', () => {
  it('routes /api/decap/documents/* when basePath is /api/decap', async () => {
    const documentsRepo = {
      getCapabilities: () => LaikaTask.succeed(makeDocumentsCaps()),
    } as unknown as DocumentsRepository;

    const api = decapApi(makeOptions({ documents: documentsRepo, basePath: '/api/decap' }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/api/decap/documents/capabilities`, {
        headers: { Authorization: 'Bearer good-token' },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { type: string } };
    expect(body.data.type).toBe('documents-capabilities');
  });

  it('returns 404 for /documents/* (without basePath prefix) when basePath is set', async () => {
    const documentsRepo = {
      getCapabilities: () => LaikaTask.succeed(makeDocumentsCaps()),
    } as unknown as DocumentsRepository;

    const api = decapApi(makeOptions({ documents: documentsRepo, basePath: '/api/decap' }));
    const res = await api.fetch(
      new Request(`${BASE_URL}/documents/capabilities`, {
        headers: { Authorization: 'Bearer good-token' },
      }),
    );

    expect(res.status).toBe(404);
  });
});

describe('logger forwarding — assets sub-API (LCMS-353)', () => {
  it('forwards the configured logger to the assets sub-handler (error logged on unexpected 500)', async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

    const assetsRepo = {
      getCapabilities: () => {
        throw new Error('unexpected boom');
      },
    } as unknown as AssetsRepository;

    const api = decapApi(makeOptions({ assets: assetsRepo, logger }));
    const res = await api.fetch(makeRequest('/assets/capabilities', { Authorization: 'Bearer good-token' }));

    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('logger forwarding — storage sub-API (LCMS-366)', () => {
  it('forwards the configured logger to the storage sub-handler (error logged on unexpected 500)', async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

    const storageRepo = {
      getCapabilities: () => {
        throw new Error('storage boom');
      },
    } as unknown as StorageRepository;

    const api = decapApi(makeOptions({ storage: storageRepo, logger }));
    const res = await api.fetch(makeRequest('/storage/capabilities', { Authorization: 'Bearer good-token' }));

    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('logger forwarding — documents sub-API (LCMS-366)', () => {
  it('forwards the configured logger to the documents sub-handler (error logged on non-success)', async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

    const documentsRepo = {
      getCapabilities: () => {
        throw new Error('documents boom');
      },
    } as unknown as DocumentsRepository;

    const api = decapApi(makeOptions({ documents: documentsRepo, logger }));
    const res = await api.fetch(makeRequest('/documents/capabilities', { Authorization: 'Bearer good-token' }));

    expect(res.status).not.toBe(200);
    expect(logger.error).toHaveBeenCalled();
  });
});
