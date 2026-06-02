/**
 * Hapi + @hapi/vision + Nunjucks + remark Markdown rendering + LaikaCMS.
 *
 * Three things this starter shows that others don't:
 *
 *   1. @hapi/vision plugin — Hapi's official template rendering plugin.
 *      Templates are configured via server.views() and rendered with
 *      h.view('template', data) in route handlers. No middleware — all
 *      behaviour is opt-in through Hapi's explicit plugin registration.
 *
 *   2. Hapi's payload pre-read pattern — unlike Express (middleware pipeline)
 *      or Koa (async iteration), Hapi pre-drains the request body before your
 *      handler runs if you set `payload.output: 'data', parse: false`.
 *      The raw Buffer is available as `request.payload` — no streaming needed.
 *
 *   3. Lowercase Hapi methods — Hapi's `request.method` is lowercase ('get',
 *      'post', etc.) while WHATWG Request requires uppercase. Docs don't call
 *      this out, but forgetting `toUpperCase()` silently breaks GET/HEAD body
 *      restrictions in the WHATWG fetch spec.
 */
import { join, resolve } from 'node:path';

import Hapi from '@hapi/hapi';
import Inert from '@hapi/inert';
import Vision from '@hapi/vision';
import { collectStream, runTask } from 'laikacms/compat';
import nunjucks from 'nunjucks';

import { laika } from './laika.js';
import { renderMarkdown } from './md.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const PUBLIC_DIR = resolve(process.cwd(), 'public');
const VIEWS_DIR = resolve(process.cwd(), 'views');

// Bridge a Hapi request to a WHATWG Request for laika.fetch.
function toLaikaRequest(request: Hapi.Request): Request {
  const host = request.info.host || 'localhost';
  const url = new URL(request.path, `http://${host}`);
  url.search = request.url.search ?? '';

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && request.payload;

  let body: ArrayBuffer | undefined;
  if (hasBody && Buffer.isBuffer(request.payload)) {
    const buf = request.payload;
    body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  return new Request(url, {
    method,
    headers: request.headers as HeadersInit,
    body: body ?? null,
    ...(body !== undefined ? { duplex: 'half' } : {}),
  } as RequestInit);
}

async function toHapiResponse(webRes: Response, h: Hapi.ResponseToolkit): Promise<Hapi.ResponseObject> {
  const body = Buffer.from(await webRes.arrayBuffer());
  const response = h.response(body).code(webRes.status);
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') response.header(name, value);
  });
  return response;
}

async function start(): Promise<void> {
  const server = Hapi.server({ port: PORT, host: 'localhost' });

  // Register @hapi/inert (static files) and @hapi/vision (templates).
  // Hapi requires all plugins to be registered before routes are defined.
  await server.register([Inert, Vision]);

  // Configure @hapi/vision with Nunjucks.
  // `@hapi/vision` calls engine.compile(templateSrc, options) → render(context).
  // We wrap nunjucks.compile() to bridge the API.
  const env = nunjucks.configure(VIEWS_DIR, { autoescape: true });

  server.views({
    engines: {
      html: {
        compile: (src: string) => {
          const template = nunjucks.compile(src, env);
          return (context: object) => template.render(context);
        },
      },
    },
    relativeTo: resolve(process.cwd()),
    path: 'views',
    isCached: process.env['NODE_ENV'] === 'production',
  });

  // Decap JSON:API proxy — pre-drain body as raw Buffer.
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

  // Blog index.
  server.route({
    method: 'GET',
    path: '/',
    handler: async (_req, h) => {
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
        })
        .map(r => ({
          slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
          date: r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : null,
        }));

      return h.view('index.html', { title: 'My Blog', posts });
    },
  });

  // Blog post — renders Markdown body to safe HTML via remark pipeline.
  server.route({
    method: 'GET',
    path: '/blog/{slug}',
    handler: async (request, h) => {
      const slug = request.params['slug'] as string;

      let title: string;
      let bodyHtml: string;
      let date: string | null;

      try {
        const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
        const content = post.content as { title?: string, date?: string, body?: string };

        title = content.title ?? slug;
        date = content.date ? new Date(content.date).toLocaleDateString() : null;
        bodyHtml = await renderMarkdown(content.body ?? '');
      } catch {
        return h.view('404.html', { title: 'Not found' }).code(404);
      }

      return h.view('post.html', { title, date, bodyHtml });
    },
  });

  // Static files — admin UI and uploads via @hapi/inert directory handler.
  server.route({
    method: 'GET',
    path: '/admin/{path*}',
    handler: {
      directory: { path: join(PUBLIC_DIR, 'admin'), index: true, redirectToSlash: true },
    },
  });

  server.route({
    method: 'GET',
    path: '/uploads/{path*}',
    handler: {
      directory: { path: join(PUBLIC_DIR, 'uploads'), listing: false },
    },
  });

  await server.start();
  console.log(`Server running at http://localhost:${PORT}`);
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
