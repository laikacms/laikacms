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

  it('response body contains the user id and email', async () => {
    const api = decapApi(makeOptions());
    const res = await api.fetch(
      makeRequest('/session', { Authorization: 'Bearer good-token' }),
    );
    const body = await res.json();

    expect(body.data.attributes.id).toBe(MOCK_USER.id);
    expect(body.data.attributes.email).toBe(MOCK_USER.email);
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
