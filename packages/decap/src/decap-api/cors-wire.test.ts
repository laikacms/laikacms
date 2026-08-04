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
  authorize: () => true,
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

describe('A 401 does not corrupt subsequent responses (LCMS-439)', () => {
  // The defect: @hono/node-server's responseViaCache mutates the plain-object headers
  // passed to new Response(). SECURITY_HEADERS is a shared singleton, so after the first
  // 401 (non-CORS path: no Origin → responseViaCache) it gained Content-Length: <401 body
  // size>. Every following response — including /health at ~54 bytes — then declared that
  // wrong length, causing ECONNRESET / "terminated: other side closed" on Node clients and
  // ERR_CONTENT_LENGTH_MISMATCH on Chromium. curl was unaffected because it is more lenient
  // about Content-Length mismatches. Fix: always spread SECURITY_HEADERS so each Response
  // receives a fresh copy.

  it('GET /health is served correctly after a 401 on the non-CORS path', async () => {
    // Trigger a 401 WITHOUT an Origin header so it goes through responseViaCache
    // (the path that would mutate a shared headers object before the fix).
    const r401 = await fetch(`${baseUrl}/session`);
    await r401.arrayBuffer(); // drain response body
    expect(r401.status).toBe(401);

    // The health endpoint must still return 200 with the correct Content-Length.
    const r200 = await fetch(`${baseUrl}/health`);
    const body = await r200.text();
    expect(r200.status).toBe(200);
    expect(r200.headers.get('Content-Length')).toBe(String(Buffer.byteLength(body)));
    expect(JSON.parse(body)).toMatchObject({ status: 'ok' });
  });

  it('GET /health Content-Length matches its own body, not the prior 401 body', async () => {
    // Belt-and-suspenders: explicitly verify the Content-Length isn't the 401 body size.
    const r401 = await fetch(`${baseUrl}/session`);
    const body401 = await r401.text();

    const r200 = await fetch(`${baseUrl}/health`);
    const body200 = await r200.text();

    expect(r200.status).toBe(200);
    // Before the fix: Content-Length was the 401 body length, not the 200 body length.
    expect(r200.headers.get('Content-Length')).not.toBe(String(Buffer.byteLength(body401)));
    expect(r200.headers.get('Content-Length')).toBe(String(Buffer.byteLength(body200)));
  });
});
