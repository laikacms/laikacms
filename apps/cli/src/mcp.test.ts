import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalMcpServer, buildRemoteMcpServer } from './mcp.js';

interface ToolText {
  content: { type: string, text: string }[];
  isError?: boolean;
}

/** Drive `server` through an in-memory transport pair — the stdio wiring minus the pipes. */
async function connect(server: Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('buildLocalMcpServer', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'laika-mcp-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists the two generic tools from @laikacms/server/mcp', async () => {
    const client = await connect(buildLocalMcpServer({ root }));
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(['api_request', 'read_api_spec']);
  });

  it('serves the storage API spec index over read_api_spec', async () => {
    const client = await connect(buildLocalMcpServer({ root }));
    const result = await client.callTool({ name: 'read_api_spec', arguments: {} }) as ToolText;
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Laika CMS Storage API');
    expect(result.content[0]?.text).toContain('/objects/{key}');
  });

  it('reads a real file through api_request, in-process', async () => {
    await writeFile(path.join(root, 'hello.json'), JSON.stringify({ title: 'Hello' }));
    const client = await connect(buildLocalMcpServer({ root }));
    const result = await client.callTool({
      name: 'api_request',
      arguments: { method: 'GET', path: '/objects/hello' },
    }) as ToolText;
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('HTTP 200');
    expect(result.content[0]?.text).toContain('Hello');
  });

  it('writes a real file through api_request', async () => {
    const client = await connect(buildLocalMcpServer({ root, defaultExtension: 'json' }));
    const result = await client.callTool({
      name: 'api_request',
      arguments: {
        method: 'POST',
        path: '/objects',
        body: { data: { type: 'object', id: 'greeting', attributes: { content: { title: 'Hi' } } } },
      },
    }) as ToolText;
    expect(result.isError).toBe(false);
    const written = JSON.parse(await readFile(path.join(root, 'greeting.json'), 'utf8')) as { title: string };
    expect(written.title).toBe('Hi');
  });
});

describe('buildRemoteMcpServer', () => {
  it('proxies api_request to the base URL with the auth token as a Bearer', async () => {
    const seen: Request[] = [];
    const client = await connect(buildRemoteMcpServer({
      baseUrl: 'https://cms.example.com/api',
      authToken: 'secret-token',
      fetch: async request => {
        seen.push(request);
        return new Response('{"data":[]}', { status: 200 });
      },
    }));

    const result = await client.callTool({
      name: 'api_request',
      arguments: { method: 'GET', path: '/api/documents/records' },
    }) as ToolText;

    expect(result.isError).toBe(false);
    expect(seen).toHaveLength(1);
    const request = seen[0] as Request;
    expect(request.url).toBe('https://cms.example.com/api/documents/records');
    expect(request.headers.get('Authorization')).toBe('Bearer secret-token');
  });

  it('gates api_request to paths under the base URL', async () => {
    let dispatched = 0;
    const client = await connect(buildRemoteMcpServer({
      baseUrl: 'https://cms.example.com/api',
      fetch: async () => {
        dispatched += 1;
        return new Response('{}');
      },
    }));
    const result = await client.callTool({
      name: 'api_request',
      arguments: { method: 'GET', path: '/oauth2/token' },
    }) as ToolText;
    expect(result.isError).toBe(true);
    expect(dispatched).toBe(0);
  });

  it('serves the combined laikaApi contract (documents + storage + assets) over read_api_spec', async () => {
    const client = await connect(buildRemoteMcpServer({
      baseUrl: 'https://cms.example.com/api',
      fetch: async () => new Response('{}'),
    }));
    const result = await client.callTool({ name: 'read_api_spec', arguments: {} }) as ToolText;
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('base /api');
    expect(text).toContain('/documents/records');
    expect(text).toContain('/storage/objects');
    expect(text).toContain('/assets');
  });

  it('rejects a relative base URL', () => {
    expect(() => buildRemoteMcpServer({ baseUrl: '/api' })).toThrow();
  });
});
