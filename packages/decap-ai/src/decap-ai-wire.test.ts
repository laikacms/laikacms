/**
 * Wire-level regression test for the SECURITY_HEADERS singleton mutation bug (LCMS-440).
 *
 * The defect is invisible when calling `api.fetch()` in-process: Content-Length
 * reads back null and the body still resolves. It only surfaces once @hono/node-server
 * serialises the response onto a real socket — so these tests boot the handler on a port.
 *
 * Failure mode before the fix:
 *   - First error response (401) causes @hono/node-server's responseViaCache to mutate
 *     the shared SECURITY_HEADERS object, writing `Content-Length: <401 body size>` into it.
 *   - Every subsequent response (including /health) then advertises that wrong length while
 *     sending a different number of bytes.
 *   - Node clients: ECONNRESET / "terminated: other side closed".
 *   - Chromium: ERR_CONTENT_LENGTH_MISMATCH.
 *   - curl: unaffected (more lenient about mismatches).
 */

import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { decapAi } from './decap-ai.js';
import type { AiSession, AiSessionCallbacks, DecapAiConfig } from './types.js';

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    convertToModelMessages: vi.fn().mockResolvedValue([]),
    streamText: vi.fn().mockReturnValue({
      consumeStream: vi.fn(),
      toUIMessageStreamResponse: vi.fn().mockReturnValue(
        new Response('stream', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      ),
    }),
  };
});

const sessions = new Map<string, AiSession>();
const callbacks: AiSessionCallbacks = {
  createSession: vi.fn(async s => {
    sessions.set(s.id, s);
  }),
  getSession: vi.fn(async id => sessions.get(id) ?? null),
  updateSession: vi.fn(async s => {
    sessions.set(s.id, s);
  }),
  deleteSession: vi.fn(async id => {
    sessions.delete(id);
  }),
  getSessionsByDocument: vi.fn(async () => []),
};

const config: DecapAiConfig = {
  authenticateAccessToken: vi.fn().mockRejectedValue(new Error('no token')),
  model: {} as DecapAiConfig['model'],
  callbacks,
};

const api = decapAi(config);

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

describe('A 401 does not corrupt subsequent responses (LCMS-440)', () => {
  it('GET /api/ai/health is served correctly after a 401 on the non-CORS path', async () => {
    // Trigger a 401 by requesting an auth-gated endpoint without a token.
    const r401 = await fetch(`${baseUrl}/api/ai/chat`, { method: 'POST' });
    await r401.arrayBuffer(); // drain body
    expect(r401.status).toBe(401);

    // Health must still return 200 with Content-Length matching its own body.
    const r200 = await fetch(`${baseUrl}/api/ai/health`);
    const body = await r200.text();
    expect(r200.status).toBe(200);
    expect(r200.headers.get('Content-Length')).toBe(String(Buffer.byteLength(body)));
    expect(JSON.parse(body)).toMatchObject({ status: 'ok' });
  });

  it('GET /api/ai/health Content-Length matches its own body, not the prior 401 body', async () => {
    const r401 = await fetch(`${baseUrl}/api/ai/chat`, { method: 'POST' });
    const body401 = await r401.text();

    const r200 = await fetch(`${baseUrl}/api/ai/health`);
    const body200 = await r200.text();

    expect(r200.status).toBe(200);
    // Before the fix: Content-Length was the 401 body length, not the 200 body length.
    expect(r200.headers.get('Content-Length')).not.toBe(String(Buffer.byteLength(body401)));
    expect(r200.headers.get('Content-Length')).toBe(String(Buffer.byteLength(body200)));
  });
});
