/**
 * Zero-dependency Node.js HTTP server. The whole thing is node:http +
 * createEmbeddedLaika. No Hono, no Express, no framework.
 *
 * Read this file to understand the minimum LaikaCMS surface:
 *   1. Build a `laika` with one `createEmbeddedLaika(...)` call.
 *   2. Convert the incoming Node `IncomingMessage` to a web-standard
 *      `Request`. (~15 lines.)
 *   3. Call `laika.fetch(request)` → `Response`.
 *   4. Pipe the response back into `ServerResponse`. (~10 lines.)
 *
 * Use this when:
 *   - You want to understand what every other backend starter is doing under
 *     the hood.
 *   - You need a frame-free LaikaCMS server (embedded inside another tool).
 *   - The serverless runtime you target can't bundle a framework (rare).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

const PORT = Number(process.env.PORT ?? 3000);
const decapConfig = minimalBlogConfig();

const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS node:http starter' });

// IncomingMessage → web Request. Same trick used by every other adapter.
function toWebRequest(req: IncomingMessage): Request {
  const protocol = (req.headers['x-forwarded-proto'] as string) || 'http';
  const url = new URL(req.url ?? '/', `${protocol}://${req.headers.host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach(val => headers.append(k, val));
    else if (v !== undefined) headers.set(k, v);
  }
  const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers };
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

// web Response → ServerResponse pipe.
async function pipeWebResponse(res: ServerResponse, web: Response): Promise<void> {
  res.statusCode = web.status;
  web.headers.forEach((value, key) => res.setHeader(key, value));
  if (web.body) {
    Readable.fromWeb(web.body as unknown as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
  } else {
    res.end();
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';

  // Built-in routes.
  if (url === '/' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return void res.end(
      JSON.stringify({
        name: '@laikacms/starter-node-http',
        runtime: `Node.js ${process.version}`,
        loc: 'see src/server.ts — the entire backend is ~80 lines',
        endpoints: {
          'GET /': 'this index',
          'GET /admin': 'Decap CMS admin shell',
          'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
          'GET /posts': 'public list of published posts',
          'GET /posts/:slug': 'public single-post endpoint',
        },
      }),
    );
  }

  if (url === '/admin' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return void res.end(ADMIN_HTML);
  }

  if (url.startsWith('/api/decap/')) {
    return void pipeWebResponse(res, await laika.fetch(toWebRequest(req)));
  }

  if (url === '/posts' && req.method === 'GET') {
    const { items } = await collectStream(
      laika.documents.listRecords({
        folder: 'posts',
        depth: 1,
        pagination: { offset: 0, limit: 100 },
        type: 'published',
      }),
    );
    res.setHeader('Content-Type', 'application/json');
    return void res.end(
      JSON.stringify({
        posts: items
          .filter(i => i.type === 'published')
          .map(item => ({
            key: (item as { key: string }).key,
            content: (item as { content?: unknown }).content,
          })),
      }),
    );
  }

  const postMatch = /^\/posts\/([^/?#]+)/.exec(url);
  if (postMatch && req.method === 'GET') {
    const slug = decodeURIComponent(postMatch[1]!);
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
      res.setHeader('Content-Type', 'application/json');
      return void res.end(JSON.stringify({ post: doc }));
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.statusCode = 404;
        return void res.end(JSON.stringify({ error: 'Not found' }));
      }
      throw err;
    }
  }

  res.statusCode = 404;
  res.end('Not Found');
}

createServer((req, res) => {
  handle(req, res).catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });
}).listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS node:http backend listening on http://localhost:${PORT}`);
});
