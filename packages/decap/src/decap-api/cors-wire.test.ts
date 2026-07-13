/**
 * Wire-level regression tests for the CORS response path (LCMS-437).
 *
 * The chunked-vs-Content-Length defect is invisible on an in-process `Response`:
 * `.json()` resolves and `content-length` reads back null whether the body is a
 * stream or a buffer. It only becomes observable once a real Node HTTP adapter
 * serialises the response onto a socket — which is why these tests boot the API
 * on a port instead of calling `api.fetch()` directly.
 */

import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { decapApi } from './index.js';
import type { DecapOptions, User } from './index.js';

const MOCK_USER: User = { id: 'u1', email: 'test@example.com', name: 'Test User' };
const ADMIN_ORIGIN = 'http://localhost:5000';

const api = decapApi({
  documents: {} as DecapOptions['documents'],
  storage: {} as DecapOptions['storage'],
  authenticateAccessToken: vi.fn().mockResolvedValue(MOCK_USER),
  cors: { origins: [ADMIN_ORIGIN] },
});

let server: ServerType;
let baseUrl = '';

beforeAll(async () => {
  await new Promise<void>(resolve => {
    server = serve({ fetch: request => api.fetch(request), port: 0 }, info => {
      baseUrl = `http://localhost:${info.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('CORS responses are serialised with Content-Length, not chunked (LCMS-437)', () => {
  it('GET /health with an Origin header carries a Content-Length matching the body', async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { Origin: ADMIN_ORIGIN } });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ADMIN_ORIGIN);
    // Chromium aborts a cross-origin response whose framing it cannot trust:
    // chunked here meant ERR_CONTENT_LENGTH_MISMATCH and the admin never authenticated.
    expect(res.headers.get('Transfer-Encoding')).toBeNull();
    expect(res.headers.get('Content-Length')).toBe(String(Buffer.byteLength(body)));
  });

  it('GET /health without an Origin header is unaffected (the non-CORS path)', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('Transfer-Encoding')).toBeNull();
    expect(res.headers.get('Content-Length')).toBe(String(Buffer.byteLength(body)));
  });

  it('an unauthenticated cross-origin request is also framed correctly', async () => {
    // The 401 travels the same withHeaders() path, and it is the first response
    // the admin UI ever sees.
    const res = await fetch(`${baseUrl}/session`, { headers: { Origin: ADMIN_ORIGIN } });
    const body = await res.text();

    expect(res.status).toBe(401);
    expect(res.headers.get('Transfer-Encoding')).toBeNull();
    expect(res.headers.get('Content-Length')).toBe(String(Buffer.byteLength(body)));
  });
});
