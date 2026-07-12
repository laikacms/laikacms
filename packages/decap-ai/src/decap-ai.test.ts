/**
 * Unit tests for decapAi server adapter
 * Tests auth, session CRUD, ownership enforcement, and routing — all without a real AI model.
 */

import { streamText } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSession, AiSessionCallbacks, DecapAiConfig, User } from './types.js';

// ---------------------------------------------------------------------------
// Mock the `ai` SDK so tests never touch a real model
// ---------------------------------------------------------------------------
vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    convertToModelMessages: vi.fn().mockResolvedValue([]),
    streamText: vi.fn().mockReturnValue({
      consumeStream: vi.fn(),
      toUIMessageStreamResponse: vi.fn().mockReturnValue(
        new Response('stream', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    }),
  };
});

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------
import { decapAi } from './decap-ai.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID_TOKEN = 'valid-token';
const USER_A: User = { id: 'user-a', email: 'a@example.com', name: 'User A' };
const USER_B: User = { id: 'user-b', email: 'b@example.com', name: 'User B' };

function makeSession(overrides: Partial<AiSession> = {}): AiSession {
  return {
    id: 'session-1',
    documentSlug: 'posts/hello',
    userId: USER_A.id,
    title: 'Hello session',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeCallbacks(sessions: Map<string, AiSession> = new Map()): AiSessionCallbacks {
  return {
    createSession: vi.fn(async s => {
      sessions.set(s.id, s);
    }),
    getSession: vi.fn(async id => sessions.get(id) ?? null),
    getSessionsByDocument: vi.fn(async (slug, userId) =>
      [...sessions.values()].filter(s => s.documentSlug === slug && s.userId === userId)
    ),
    updateSession: vi.fn(async (id, updates) => {
      const s = sessions.get(id);
      if (s) sessions.set(id, { ...s, ...updates });
    }),
    deleteSession: vi.fn(async id => {
      sessions.delete(id);
    }),
  };
}

function makeConfig(
  overrides: Partial<DecapAiConfig> = {},
  sessions?: Map<string, AiSession>,
): DecapAiConfig {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: {} as any,
    authenticateAccessToken: vi.fn(async (token: string) => {
      if (token === VALID_TOKEN) return USER_A;
      throw new Error('Invalid token');
    }),
    callbacks: makeCallbacks(sessions),
    basePath: '/ai',
    ...overrides,
  };
}

function makeRequest(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Request {
  const { token = VALID_TOKEN, ...init } = options;
  const headers = new Headers(init.headers);
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  return new Request(`http://localhost${path}`, { ...init, headers });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('decapAi()', () => {
  describe('default basePath', () => {
    it('defaults to /api/ai — health is reachable without explicit basePath', async () => {
      const { basePath: _omit, ...baseConfig } = makeConfig();
      const adapter = decapAi(baseConfig);
      const res = await adapter.fetch(makeRequest('/api/ai/health', { token: null }));
      expect(res.status).toBe(200);
    });

    it('routes to /ai when basePath is set to /ai', async () => {
      const adapter = decapAi(makeConfig({ basePath: '/ai' }));
      const res = await adapter.fetch(makeRequest('/ai/health', { token: null }));
      expect(res.status).toBe(200);
    });
  });

  describe('authentication', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/sessions', { token: null });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/authorization/i);
    });

    it('returns 401 when token is invalid', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/sessions', { token: 'bad-token' });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/authentication/i);
    });
  });

  describe('health check', () => {
    it('GET {basePath}/health returns 200 without auth', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/health', { token: null });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('ok');
    });

    it('health check includes timestamp', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/health', { token: null });
      const res = await adapter.fetch(req);
      const body = await res.json() as { timestamp: string };
      expect(typeof body.timestamp).toBe('string');
      expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  describe('POST /ai/chat', () => {
    it('creates a new session and returns X-Session-Id header', async () => {
      const sessions = new Map<string, AiSession>();
      const adapter = decapAi(makeConfig({}, sessions));

      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Session-Id')).toBeTruthy();
      // Session should be persisted
      const sessionId = res.headers.get('X-Session-Id')!;
      expect(sessions.has(sessionId)).toBe(true);
    });

    it('returns 400 when document slug is missing', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when messages array is missing', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ document: { slug: 'posts/hello' } }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when last user message has no text content', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', parts: [] }],
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(400);
    });

    it('returns 404 when sessionId does not exist', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          sessionId: 'non-existent-session',
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(404);
    });

    it('returns 403 when sessionId belongs to a different user', async () => {
      const sessions = new Map<string, AiSession>();
      sessions.set('session-1', makeSession({ userId: USER_B.id }));

      const adapter = decapAi(makeConfig({}, sessions));
      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          sessionId: 'session-1',
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(403);
    });

    it('continues an existing session: returns 200 and echoes the same X-Session-Id', async () => {
      const sessions = new Map<string, AiSession>();
      sessions.set('session-1', makeSession({ id: 'session-1', userId: USER_A.id }));

      const adapter = decapAi(makeConfig({}, sessions));
      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Continue the conversation' }],
          sessionId: 'session-1',
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Session-Id')).toBe('session-1');
    });

    it('accepts v3 parts format for user messages', async () => {
      const sessions = new Map<string, AiSession>();
      const adapter = decapAi(makeConfig({}, sessions));

      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello from parts' }] }],
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Session-Id')).toBeTruthy();
    });

    it('returns 500 when createSession throws and calls logger.error', async () => {
      const createError = new Error('db write failure');
      const callbacks = makeCallbacks();
      vi.mocked(callbacks.createSession).mockRejectedValueOnce(createError);

      const loggerError = vi.fn();
      const config = makeConfig({ logger: { error: loggerError, warn: vi.fn(), info: vi.fn() }, callbacks });

      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await decapAi(config).fetch(req);
      expect(res.status).toBe(500);
      expect(loggerError).toHaveBeenCalledWith('AI chat error:', createError);
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe('string');
    });

    it('returns 500 when getSession throws on continuation and calls logger.error', async () => {
      const getError = new Error('db read failure');
      const callbacks = makeCallbacks();
      vi.mocked(callbacks.getSession).mockRejectedValueOnce(getError);

      const loggerError = vi.fn();
      const config = makeConfig({ logger: { error: loggerError, warn: vi.fn(), info: vi.fn() }, callbacks });

      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          sessionId: 'some-session-id',
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await decapAi(config).fetch(req);
      expect(res.status).toBe(500);
      expect(loggerError).toHaveBeenCalledWith('AI chat error:', getError);
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe('string');
    });

    it('returns 500 when streamText throws and calls logger.error', async () => {
      const modelError = new Error('model failure');
      vi.mocked(streamText).mockImplementationOnce(() => {
        throw modelError;
      });

      const loggerError = vi.fn();
      const adapter = decapAi(makeConfig({ logger: { error: loggerError, warn: vi.fn(), info: vi.fn() } }));

      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await adapter.fetch(req);
      expect(res.status).toBe(500);
      expect(loggerError).toHaveBeenCalledWith('AI chat error:', modelError);
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe('string');
    });

    it('streamText is called with built-in documentTools (getDocumentData, updateDocument) in the tools object', async () => {
      vi.mocked(streamText).mockClear();
      const adapter = decapAi(makeConfig());

      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
      expect(vi.mocked(streamText)).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.objectContaining({
            getDocumentData: expect.any(Object),
            updateDocument: expect.any(Object),
          }),
        }),
      );
    });

    it('consumer config.tools are merged alongside built-in documentTools, not replacing them', async () => {
      vi.mocked(streamText).mockClear();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = decapAi(makeConfig({ tools: { myCustomTool: { description: 'custom' } as any } }));

      const req = makeRequest('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          document: { slug: 'posts/hello' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
      expect(vi.mocked(streamText)).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.objectContaining({
            getDocumentData: expect.any(Object),
            updateDocument: expect.any(Object),
            myCustomTool: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe('GET /ai/sessions', () => {
    it('returns 400 when documentSlug query param is missing', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/sessions');
      const res = await adapter.fetch(req);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/documentSlug/i);
    });

    it('returns sessions for the authenticated user and document', async () => {
      const sessions = new Map<string, AiSession>();
      sessions.set('s1', makeSession({ id: 's1', userId: USER_A.id, documentSlug: 'posts/hello' }));
      sessions.set('s2', makeSession({ id: 's2', userId: USER_B.id, documentSlug: 'posts/hello' }));

      const adapter = decapAi(makeConfig({}, sessions));
      const req = makeRequest('/ai/sessions?documentSlug=posts%2Fhello');
      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
      const body = await res.json() as { sessions: { id: string }[] };
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].id).toBe('s1');
    });

    it('returns 405 for non-GET methods', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/sessions?documentSlug=posts%2Fhello', { method: 'POST' });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(405);
    });

    it('returns 500 when getSessionsByDocument throws', async () => {
      const callbacks = makeCallbacks();
      vi.mocked(callbacks.getSessionsByDocument).mockRejectedValueOnce(new Error('db error'));
      const adapter = decapAi(makeConfig({ callbacks }));
      const req = makeRequest('/ai/sessions?documentSlug=posts%2Fhello');
      const res = await adapter.fetch(req);
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe('string');
    });
  });

  describe('GET /ai/sessions/:id', () => {
    it('returns session detail for owner', async () => {
      const sessions = new Map<string, AiSession>();
      sessions.set('s1', makeSession({ id: 's1', userId: USER_A.id }));

      const adapter = decapAi(makeConfig({}, sessions));
      const req = makeRequest('/ai/sessions/s1');
      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
      const body = await res.json() as { session: { id: string } };
      expect(body.session.id).toBe('s1');
    });

    it('returns 403 when session belongs to a different user', async () => {
      const sessions = new Map<string, AiSession>();
      sessions.set('s1', makeSession({ id: 's1', userId: USER_B.id }));

      const adapter = decapAi(makeConfig({}, sessions));
      const req = makeRequest('/ai/sessions/s1');
      const res = await adapter.fetch(req);
      expect(res.status).toBe(403);
    });

    it('returns 404 when session does not exist', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/sessions/nonexistent');
      const res = await adapter.fetch(req);
      expect(res.status).toBe(404);
    });

    it('returns 500 when getSession throws', async () => {
      const callbacks = makeCallbacks();
      vi.mocked(callbacks.getSession).mockRejectedValueOnce(new Error('db error'));
      const adapter = decapAi(makeConfig({ callbacks }));
      const req = makeRequest('/ai/sessions/any-id');
      const res = await adapter.fetch(req);
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe('string');
    });
  });

  describe('DELETE /ai/sessions/:id', () => {
    it('deletes session for owner and returns success', async () => {
      const sessions = new Map<string, AiSession>();
      sessions.set('s1', makeSession({ id: 's1', userId: USER_A.id }));

      const adapter = decapAi(makeConfig({}, sessions));
      const req = makeRequest('/ai/sessions/s1', { method: 'DELETE' });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);
      expect(sessions.has('s1')).toBe(false);
    });

    it('returns 403 when session belongs to a different user', async () => {
      const sessions = new Map<string, AiSession>();
      sessions.set('s1', makeSession({ id: 's1', userId: USER_B.id }));

      const adapter = decapAi(makeConfig({}, sessions));
      const req = makeRequest('/ai/sessions/s1', { method: 'DELETE' });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(403);
    });

    it('returns 404 when session does not exist', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/sessions/nonexistent', { method: 'DELETE' });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(404);
    });

    it('returns 500 when getSession throws', async () => {
      const callbacks = makeCallbacks();
      vi.mocked(callbacks.getSession).mockRejectedValueOnce(new Error('db error'));
      const adapter = decapAi(makeConfig({ callbacks }));
      const req = makeRequest('/ai/sessions/any-id', { method: 'DELETE' });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe('string');
    });

    it('returns 500 when deleteSession throws after ownership check passes', async () => {
      const sessions = new Map<string, AiSession>();
      sessions.set('s1', makeSession({ id: 's1', userId: USER_A.id }));
      const callbacks = makeCallbacks(sessions);
      vi.mocked(callbacks.deleteSession).mockRejectedValueOnce(new Error('db delete error'));
      const adapter = decapAi(makeConfig({ callbacks }));
      const req = makeRequest('/ai/sessions/s1', { method: 'DELETE' });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe('string');
    });
  });

  describe('PATCH /ai/sessions/:id', () => {
    it('returns 405 for unsupported methods on session detail endpoint', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/sessions/s1', { method: 'PATCH' });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(405);
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe('string');
    });
  });

  describe('routing', () => {
    it('returns 404 for unknown endpoints', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/unknown');
      const res = await adapter.fetch(req);
      expect(res.status).toBe(404);
    });

    it('respects custom basePath', async () => {
      const adapter = decapAi(makeConfig({ basePath: '/custom-ai' }));
      const req = makeRequest('/custom-ai/health', { token: null });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
    });

    it('normalizes trailing slash on basePath', async () => {
      const adapter = decapAi(makeConfig({ basePath: '/ai/' }));
      const req = makeRequest('/ai/health', { token: null });
      const res = await adapter.fetch(req);
      expect(res.status).toBe(200);
    });
  });

  describe('security headers', () => {
    it('includes X-Content-Type-Options on error responses', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/sessions', { token: null });
      const res = await adapter.fetch(req);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('includes Cache-Control no-store on error responses', async () => {
      const adapter = decapAi(makeConfig());
      const req = makeRequest('/ai/sessions', { token: null });
      const res = await adapter.fetch(req);
      expect(res.headers.get('Cache-Control')).toContain('no-store');
    });
  });
});
