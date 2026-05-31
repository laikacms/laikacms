import { join, resolve } from 'node:path';

import Hapi from '@hapi/hapi';
import Inert from '@hapi/inert';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './lib/laika.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const PUBLIC_DIR = resolve(process.cwd(), 'public');

/**
 * Bridge a Hapi request to a WHATWG Request for laika.fetch.
 *
 * Doc gap: Hapi's route `payload` option controls how the body is pre-read.
 *   output: 'data'   → request.payload is a Buffer (body already drained)
 *   parse: false     → no JSON/form parsing — laika handles content-type itself
 *
 * This is simpler than the Express/Koa bridge because we don't need to drain
 * the IncomingMessage stream manually — Hapi does it before the handler runs.
 *
 * Doc gap: Hapi's request.method is lowercase ('get', 'post', etc.) unlike
 * Express where req.method is uppercase. Uppercase matters for WHATWG Request
 * because some methods (GET, HEAD) don't allow a body.
 */
function toLaikaRequest(request: Hapi.Request): Request {
  const host = request.info.host || 'localhost';
  const url = new URL(request.path, `http://${host}`);
  url.search = request.url.search ?? '';

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && request.payload;

  let body: ArrayBuffer | undefined;
  if (hasBody && Buffer.isBuffer(request.payload)) {
    const buf = request.payload;
    // TypeScript 6 regression: Buffer<ArrayBufferLike> is not assignable to
    // BodyInit. Extract the concrete ArrayBuffer slice as a workaround.
    body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  return new Request(url, {
    method,
    headers: request.headers as HeadersInit,
    body: body ?? null,
    // Required for bodies in streaming-capable runtimes (Node 18+)
    ...(body !== undefined ? { duplex: 'half' } : {}),
  } as RequestInit);
}

async function toHapiResponse(webRes: Response, h: Hapi.ResponseToolkit): Promise<Hapi.ResponseObject> {
  const body = Buffer.from(await webRes.arrayBuffer());
  const response = h.response(body).code(webRes.status);
  webRes.headers.forEach((value, name) => {
    // transfer-encoding is managed by Node's http module
    if (name.toLowerCase() !== 'transfer-encoding') {
      response.header(name, value);
    }
  });
  return response;
}

async function renderHome(): Promise<string> {
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  const posts = records
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });

  const listHtml = posts.length === 0
    ? `<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>`
    : `<ul style="list-style:none;padding:0">${
      posts
        .map(post => {
          const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
          const date = post.updatedAt ? new Date(post.updatedAt).toLocaleDateString() : '';
          return `<li style="margin-bottom:1.5rem"><a href="/blog/${slug}">${slug}</a>${
            date ? ` · <time>${date}</time>` : ''
          }</li>`;
        })
        .join('')
    }</ul>`;

  return page(`<h1>My Blog</h1>${listHtml}`, 'My Blog');
}

async function renderPost(slug: string): Promise<{ html: string, found: boolean }> {
  try {
    const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const { title, date, description, body } = post.content as {
      title?: string,
      date?: string,
      description?: string,
      body?: string,
    };
    const dateHtml = date ? `<time>${new Date(date).toLocaleDateString()}</time>` : '';
    const descHtml = description ? `<p><em>${esc(description)}</em></p>` : '';
    return {
      found: true,
      html: page(
        `<article>
  <h1>${esc(title ?? slug)}</h1>
  ${dateHtml}
  ${descHtml}
  <pre style="white-space:pre-wrap;font-family:inherit">${esc(body ?? '')}</pre>
</article>
<p><a href="/">← Back</a></p>`,
        title ?? slug,
      ),
    };
  } catch {
    return { found: false, html: '' };
  }
}

function page(body: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:2rem 1rem}</style>
</head>
<body>${body}</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function start(): Promise<void> {
  const server = Hapi.server({ port: PORT, host: 'localhost' });

  await server.register(Inert);

  // Decap JSON:API proxy — all methods, body pre-drained into Buffer.
  //
  // Doc gap: Hapi parses bodies by default (JSON, urlencoded). This must
  // be disabled for the Decap proxy so laika receives the raw payload.
  // payload.parse: false + payload.output: 'data' gives us the raw Buffer.
  server.route({
    method: '*',
    path: '/api/decap/{path*}',
    options: {
      payload: {
        parse: false,
        output: 'data',
        allow: ['application/json', 'multipart/form-data', '*/*'],
        maxBytes: 10 * 1024 * 1024,
      },
    },
    handler: async (request, h) => {
      const webReq = toLaikaRequest(request);
      const webRes = await laika.fetch(webReq);
      return toHapiResponse(webRes, h);
    },
  });

  // Blog pages
  server.route({
    method: 'GET',
    path: '/',
    handler: async (_req, h) => {
      const html = await renderHome();
      return h.response(html).type('text/html; charset=utf-8');
    },
  });

  server.route({
    method: 'GET',
    path: '/blog/{slug}',
    handler: async (request, h) => {
      const slug = request.params['slug'] as string;
      const { html, found } = await renderPost(slug);
      if (!found) return h.response('Not Found').code(404);
      return h.response(html).type('text/html; charset=utf-8');
    },
  });

  // Static files — admin UI and uploads.
  // @hapi/inert's directory handler serves index.html for directory requests.
  server.route({
    method: 'GET',
    path: '/admin/{path*}',
    handler: {
      directory: {
        path: join(PUBLIC_DIR, 'admin'),
        index: true,
        redirectToSlash: true,
      },
    },
  });

  server.route({
    method: 'GET',
    path: '/uploads/{path*}',
    handler: {
      directory: {
        path: join(PUBLIC_DIR, 'uploads'),
        listing: false,
      },
    },
  });

  await server.start();
  console.log(`Server running at http://localhost:${PORT}`);
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
