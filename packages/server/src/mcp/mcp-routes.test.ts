import type { OpenApiDocument } from 'laikacms/json-api';
import { describe, expect, it } from 'vitest';
import { laikaMcp, type LaikaMcpOptions, protectedResourceMetadata } from './mcp-routes.js';

const PUBLIC_URL = 'http://localhost:3101';

const OPEN_API = {
  openapi: '3.1.0',
  info: { title: 'Laika CMS API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  paths: {},
  components: {},
} as unknown as OpenApiDocument;

const makeMcp = (overrides: Partial<LaikaMcpOptions> = {}) =>
  laikaMcp({
    publicUrl: PUBLIC_URL,
    apiBasePath: '/api',
    fetch: async () => new Response('{}', { status: 200 }),
    openApi: OPEN_API,
    verifyBearer: authorization => authorization === 'Bearer valid-token' ? { id: 'user-1' } : null,
    ...overrides,
  });

describe('OAuth discovery metadata', () => {
  it('serves protected-resource metadata on both well-known paths', async () => {
    const mcp = makeMcp();
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await mcp.fetch(new Request(`${PUBLIC_URL}${path}`));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(protectedResourceMetadata(PUBLIC_URL));
    }
  });

  it('advertises an external authorization server when one is configured', async () => {
    const mcp = makeMcp({ authorizationServers: ['https://auth.example.com'] });
    const res = await mcp.fetch(new Request(`${PUBLIC_URL}/.well-known/oauth-protected-resource`));
    const body = await res.json() as { authorization_servers: string[] };
    expect(body.authorization_servers).toEqual(['https://auth.example.com']);
  });

  it('points at itself by default - the deployment hosting its own oauth2 server', () => {
    expect(protectedResourceMetadata(PUBLIC_URL)).toEqual({
      resource: `${PUBLIC_URL}/mcp`,
      authorization_servers: [PUBLIC_URL],
      bearer_methods_supported: ['header'],
    });
  });
});

describe('dynamic client registration (intentionally absent)', () => {
  it('does not serve POST /oauth2/register - the oauth2 module is single-client', async () => {
    // Pins the documented seam: when @laikacms/server/oauth2 grows RFC 7591
    // registration, it will be served on the composed app, not invented here.
    const res = await makeMcp().fetch(new Request(`${PUBLIC_URL}/oauth2/register`, { method: 'POST' }));
    expect(res.status).toBe(404);
  });
});

describe('/mcp bearer gate', () => {
  it('401s an unauthenticated request WITH the resource_metadata discovery pointer', async () => {
    const res = await makeMcp().fetch(new Request(`${PUBLIC_URL}/mcp`, { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
    const body = await res.json() as { errors: { status: string }[] };
    expect(body.errors[0]?.status).toBe('401');
  });

  it('401s an invalid bearer token', async () => {
    const res = await makeMcp().fetch(
      new Request(`${PUBLIC_URL}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer never-issued' } }),
    );
    expect(res.status).toBe(401);
  });

  it('fails closed when the bearer gate throws', async () => {
    const mcp = makeMcp({
      verifyBearer: () => {
        throw new Error('session store down');
      },
    });
    const res = await mcp.fetch(
      new Request(`${PUBLIC_URL}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer valid-token' } }),
    );
    expect(res.status).toBe(401);
  });

  it('serves an MCP initialize round-trip for a valid bearer', async () => {
    const res = await makeMcp().fetch(
      new Request(`${PUBLIC_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('laikacms');
  });
});

describe('composition', () => {
  it('404s unknown paths with a JSON:API error body so mis-mounting surfaces clearly', async () => {
    const res = await makeMcp().fetch(new Request(`${PUBLIC_URL}/api/documents/records`));
    expect(res.status).toBe(404);
    const body = await res.json() as { errors: unknown[] };
    expect(body.errors).toHaveLength(1);
  });
});
