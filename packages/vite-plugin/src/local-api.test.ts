import * as fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFsStorage, createRepositories } from './backend.js';
import {
  type ConnectMiddleware,
  DEFAULT_LOCAL_API_BASE_PATH,
  type LocalApiServer,
  mountLocalApi,
} from './local-api.js';
import { laikacms } from './plugin.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-local-api-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** A fake ViteDevServer capturing route registrations and warnings. */
function fakeServer(opts: { host?: string | boolean } = {}) {
  const routes = new Map<string, ConnectMiddleware>();
  const warnings: string[] = [];
  const server: LocalApiServer = {
    middlewares: {
      use: (route, handler) => {
        routes.set(route, handler);
      },
    },
    config: {
      server: { host: opts.host },
      logger: { warn: msg => warnings.push(msg) },
    },
  };
  return { server, routes, warnings };
}

/** Drive a captured Connect middleware as a `fetch(Request) => Response` handler. */
function callMiddleware(handler: ConnectMiddleware, request: Request): Promise<Response> {
  const nodeReadable = request.body
    ? Readable.fromWeb(request.body as never)
    : Readable.from([]);
  const req = Object.assign(nodeReadable, {
    headers: Object.fromEntries(request.headers.entries()),
    url: new URL(request.url).pathname + new URL(request.url).search,
    method: request.method,
  }) as unknown as IncomingMessage;

  const chunks: Buffer[] = [];
  const headers = new Headers();
  let statusCode = 200;
  let resolve!: (response: Response) => void;
  const result = new Promise<Response>(r => {
    resolve = r;
  });
  const res = {
    setHeader: (key: string, value: string) => {
      headers.set(key, value);
      return res;
    },
    write: (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end: (chunk?: Buffer | string) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      resolve(new Response(Buffer.concat(chunks), { status: statusCode, headers }));
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
  } as unknown as ServerResponse;

  handler(req, res, err => {
    if (err) throw err;
  });
  return result;
}

/** Build a plugin's repositories backed by a temp filesystem storage. */
function makeRepos() {
  return createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
}

describe('mountLocalApi', () => {
  it('mounts storage and documents JSON:API under the default base path', async () => {
    const repos = makeRepos();
    const { server, routes } = fakeServer();

    mountLocalApi(server, repos, true);

    expect([...routes.keys()].sort()).toEqual([
      `${DEFAULT_LOCAL_API_BASE_PATH}/documents`,
      `${DEFAULT_LOCAL_API_BASE_PATH}/storage`,
    ]);
  });

  it('relocates both sub-routes under a custom basePath', () => {
    const repos = makeRepos();
    const { server, routes } = fakeServer();

    mountLocalApi(server, repos, { basePath: '/api/local' });

    expect([...routes.keys()].sort()).toEqual(['/api/local/documents', '/api/local/storage']);
  });

  it('reads and writes storage objects with no authorization required', async () => {
    const repos = makeRepos();
    const { server, routes } = fakeServer();
    mountLocalApi(server, repos, true);
    const storageHandler = routes.get(`${DEFAULT_LOCAL_API_BASE_PATH}/storage`)!;

    // POST creates a new object.
    const createRes = await callMiddleware(
      storageHandler,
      new Request(`http://localhost${DEFAULT_LOCAL_API_BASE_PATH}/storage/objects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { type: 'object', id: 'notes/hello', attributes: { content: { title: 'Hi' } } } }),
      }),
    );
    expect(createRes.status).toBe(201);
    // Writes flow through the plugin's own repository, landing on disk.
    const onDisk = JSON.parse(await fs.readFile(path.join(tmpDir, 'content', 'notes', 'hello.json'), 'utf8'));
    expect(onDisk).toEqual({ title: 'Hi' });

    // GET reads it back.
    const getRes = await callMiddleware(
      storageHandler,
      new Request(`http://localhost${DEFAULT_LOCAL_API_BASE_PATH}/storage/objects/notes%2Fhello`),
    );
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as { data: { attributes: { content: { title: string } } } };
    expect(getBody.data.attributes.content).toEqual({ title: 'Hi' });

    // PATCH updates it.
    const patchRes = await callMiddleware(
      storageHandler,
      new Request(`http://localhost${DEFAULT_LOCAL_API_BASE_PATH}/storage/objects/notes%2Fhello`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'object', id: 'notes/hello', attributes: { content: { title: 'Updated' } } },
        }),
      }),
    );
    expect(patchRes.status).toBe(200);
    const updatedOnDisk = JSON.parse(await fs.readFile(path.join(tmpDir, 'content', 'notes', 'hello.json'), 'utf8'));
    expect(updatedOnDisk).toEqual({ title: 'Updated' });

    // DELETE removes it.
    const deleteRes = await callMiddleware(
      storageHandler,
      new Request(`http://localhost${DEFAULT_LOCAL_API_BASE_PATH}/storage/objects/notes%2Fhello`, {
        method: 'DELETE',
      }),
    );
    expect(deleteRes.status).toBe(200);
    await expect(fs.access(path.join(tmpDir, 'content', 'notes', 'hello.json'))).rejects.toThrow();
  });

  it('reads and writes documents with no authorization required', async () => {
    const repos = makeRepos();
    const { server, routes } = fakeServer();
    mountLocalApi(server, repos, true);
    const documentsHandler = routes.get(`${DEFAULT_LOCAL_API_BASE_PATH}/documents`)!;

    const createRes = await callMiddleware(
      documentsHandler,
      new Request(`http://localhost${DEFAULT_LOCAL_API_BASE_PATH}/documents/published`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'published',
            id: 'posts/new',
            attributes: { status: 'published', content: { title: 'Hello' } },
          },
        }),
      }),
    );
    expect(createRes.status).toBe(201);

    const getRes = await callMiddleware(
      documentsHandler,
      new Request(`http://localhost${DEFAULT_LOCAL_API_BASE_PATH}/documents/published/posts%2Fnew`),
    );
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as { data: { attributes: { content: { title: string } } } };
    expect(getBody.data.attributes.content.title).toBe('Hello');
  });

  it('emits exactly one warning when the dev host is non-loopback, and still mounts', () => {
    const repos = makeRepos();
    const { server, routes, warnings } = fakeServer({ host: true });

    mountLocalApi(server, repos, true);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/non-loopback|--host/);
    expect(routes.size).toBe(2);
  });

  it.each([undefined, 'localhost', '127.0.0.1', '::1'] as const)(
    'does not warn for loopback host %s',
    host => {
      const repos = makeRepos();
      const { server, warnings } = fakeServer({ host });
      mountLocalApi(server, repos, true);
      expect(warnings).toHaveLength(0);
    },
  );
});

describe('laikacms() plugin — localApi wiring', () => {
  it('is off by default and mounts nothing', () => {
    const plugin = laikacms({
      storage: createFsStorage({ dir: path.join(tmpDir, 'content') }),
      typegen: false,
      hmr: false,
    });
    (plugin.configResolved as (c: { root: string, command: string }) => void)({ root: tmpDir, command: 'serve' });
    const { server, routes } = fakeServer();

    (plugin.configureServer as (s: LocalApiServer) => void)(server);

    expect(routes.size).toBe(0);
  });

  it('mounts under the dev-server hook when enabled', () => {
    const plugin = laikacms({
      storage: createFsStorage({ dir: path.join(tmpDir, 'content') }),
      typegen: false,
      hmr: false,
      localApi: true,
    });
    (plugin.configResolved as (c: { root: string, command: string }) => void)({ root: tmpDir, command: 'serve' });
    const { server, routes } = fakeServer();

    (plugin.configureServer as (s: LocalApiServer) => void)(server);

    expect([...routes.keys()].sort()).toEqual([
      `${DEFAULT_LOCAL_API_BASE_PATH}/documents`,
      `${DEFAULT_LOCAL_API_BASE_PATH}/storage`,
    ]);
  });

  it('is wired only under configureServer — no configurePreviewServer hook exists', () => {
    const plugin = laikacms({
      storage: createFsStorage({ dir: path.join(tmpDir, 'content') }),
      typegen: false,
      hmr: false,
      localApi: true,
    });
    expect(plugin.configurePreviewServer).toBeUndefined();
    expect(typeof plugin.configureServer).toBe('function');
  });
});

describe('@laikacms/vite-plugin dependency boundary', () => {
  it('does not depend on @laikacms/decap', async () => {
    const pkgPath = path.resolve(import.meta.dirname, '../package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>,
      devDependencies?: Record<string, string>,
    };
    expect(pkg.dependencies?.['@laikacms/decap']).toBeUndefined();
    expect(pkg.devDependencies?.['@laikacms/decap']).toBeUndefined();
    expect(pkg.dependencies?.laikacms).toBeDefined();
  });
});
