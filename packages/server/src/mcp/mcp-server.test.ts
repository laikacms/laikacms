import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { OpenApiDocument } from 'laikacms/json-api';
import { describe, expect, it } from 'vitest';
import { createLaikaMcpServer, type FetchHandler, resolveApiRequestUrl } from './mcp-server.js';

const API_URL = 'http://laika.local/api';

const OPEN_API = {
  openapi: '3.1.0',
  info: { title: 'Laika CMS API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  paths: {
    '/documents/records': {
      get: { tags: ['documents/records'], summary: 'List records', responses: {} },
    },
  },
  components: {},
} as unknown as OpenApiDocument;

interface ToolText {
  content: { type: string, text: string }[];
  isError?: boolean;
}

/** Connect a linked client to a fresh server and return the client. */
async function connect(options: { fetch: FetchHandler, authorization?: string, maxToolResponseChars?: number }) {
  const server = createLaikaMcpServer({
    apiUrl: API_URL,
    fetch: options.fetch,
    openApi: OPEN_API,
    authorization: options.authorization,
    maxToolResponseChars: options.maxToolResponseChars,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/vnd.api+json' } });

describe('tool listing', () => {
  it('exposes exactly the two generic tools - the API is the product', async () => {
    const client = await connect({ fetch: async () => jsonResponse({}) });
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(['api_request', 'read_api_spec']);
  });
});

describe('api_request', () => {
  it('dispatches into the provided fetch handler with method, query and Authorization attached', async () => {
    const seen: Request[] = [];
    const client = await connect({
      authorization: 'Bearer caller-token',
      fetch: async request => {
        seen.push(request);
        return jsonResponse({ data: [] });
      },
    });

    const result = await client.callTool({
      name: 'api_request',
      arguments: { method: 'get', path: '/api/documents/records', query: { 'filter[folder]': 'posts' } },
    }) as ToolText;

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('HTTP 200');
    expect(seen).toHaveLength(1);
    const request = seen[0] as Request;
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/api/documents/records');
    expect(new URL(request.url).searchParams.get('filter[folder]')).toBe('posts');
    expect(request.headers.get('Authorization')).toBe('Bearer caller-token');
  });

  it('serializes JSON bodies for mutations', async () => {
    const seen: { contentType: string | null, body: string }[] = [];
    const client = await connect({
      fetch: async request => {
        seen.push({ contentType: request.headers.get('Content-Type'), body: await request.text() });
        return jsonResponse({ data: {} }, 201);
      },
    });

    const result = await client.callTool({
      name: 'api_request',
      arguments: { method: 'POST', path: '/api/documents/published', body: { data: { id: 'posts/hello' } } },
    }) as ToolText;

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('HTTP 201');
    expect(seen[0]?.contentType).toBe('application/json');
    expect(JSON.parse(seen[0]?.body ?? '')).toEqual({ data: { id: 'posts/hello' } });
  });

  it('marks 4xx/5xx responses as tool errors, body included', async () => {
    const client = await connect({
      fetch: async () => jsonResponse({ errors: [{ status: '404', title: 'Not Found' }] }, 404),
    });
    const result = await client.callTool({
      name: 'api_request',
      arguments: { method: 'GET', path: '/api/documents/published/missing' },
    }) as ToolText;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('HTTP 404');
    expect(result.content[0]?.text).toContain('Not Found');
  });

  it('caps tool output so a huge listing cannot flood the model context', async () => {
    const client = await connect({
      maxToolResponseChars: 100,
      fetch: async () => jsonResponse('x'.repeat(500)),
    });
    const result = await client.callTool({
      name: 'api_request',
      arguments: { method: 'GET', path: '/api/documents/records' },
    }) as ToolText;
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('truncated at 100 chars');
    expect(text.length).toBeLessThan(300);
  });

  it('rejects unknown methods and paths outside the API base without dispatching', async () => {
    let dispatched = 0;
    const client = await connect({
      fetch: async () => {
        dispatched += 1;
        return jsonResponse({});
      },
    });

    const badMethod = await client.callTool({
      name: 'api_request',
      arguments: { method: 'TRACE', path: '/api/documents/records' },
    }) as ToolText;
    expect(badMethod.isError).toBe(true);
    expect(badMethod.content[0]?.text).toContain('Invalid method');

    const badPath = await client.callTool({
      name: 'api_request',
      arguments: { method: 'GET', path: '/oauth2/token' },
    }) as ToolText;
    expect(badPath.isError).toBe(true);
    expect(badPath.content[0]?.text).toContain('Invalid path');

    expect(dispatched).toBe(0);
  });

  it('surfaces a throwing fetch handler as a tool error, not a protocol failure', async () => {
    const client = await connect({
      fetch: async () => {
        throw new Error('backend unreachable');
      },
    });
    const result = await client.callTool({
      name: 'api_request',
      arguments: { method: 'GET', path: '/api/documents/records' },
    }) as ToolText;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('backend unreachable');
  });
});

describe('read_api_spec', () => {
  it('serves the index unfiltered and a slice when filtered', async () => {
    const client = await connect({ fetch: async () => jsonResponse({}) });

    const index = await client.callTool({ name: 'read_api_spec', arguments: {} }) as ToolText;
    expect(index.isError).toBe(false);
    expect(index.content[0]?.text).toContain('INDEX');
    expect(index.content[0]?.text).toContain('GET    /documents/records');

    const slice = await client.callTool({
      name: 'read_api_spec',
      arguments: { paths: ['/documents/records'] },
    }) as ToolText;
    const parsed = JSON.parse(slice.content[0]?.text ?? '') as { paths?: Record<string, unknown> };
    expect(Object.keys(parsed.paths ?? {})).toEqual(['/documents/records']);
  });
});

describe('resolveApiRequestUrl - the api_request path gate', () => {
  it('accepts paths under the API base and rejects everything else', () => {
    expect(resolveApiRequestUrl(API_URL, '/api/documents/records')?.pathname).toBe('/api/documents/records');
    expect(resolveApiRequestUrl(API_URL, '/api')?.pathname).toBe('/api');
    expect(resolveApiRequestUrl(API_URL, '/oauth2/token')).toBeNull();
    expect(resolveApiRequestUrl(API_URL, '/mcp')).toBeNull();
    expect(resolveApiRequestUrl(API_URL, 'api/documents/records')).toBeNull();
    expect(resolveApiRequestUrl(API_URL, '')).toBeNull();
  });

  it('allows any path when the API sits at the origin root', () => {
    expect(resolveApiRequestUrl('http://laika.local', '/objects/hello')?.pathname).toBe('/objects/hello');
  });

  it('normalizes dot segments BEFORE the gate so traversal cannot escape the base', () => {
    expect(resolveApiRequestUrl(API_URL, '/api/../oauth2/token')).toBeNull();
    expect(resolveApiRequestUrl(API_URL, '/api/documents/../../../mcp')).toBeNull();
  });

  it('rejects absolute URLs that jump origin', () => {
    expect(resolveApiRequestUrl(API_URL, 'https://evil.example/api/x')).toBeNull();
    expect(resolveApiRequestUrl(API_URL, '//evil.example/api/x')).toBeNull();
  });
});
