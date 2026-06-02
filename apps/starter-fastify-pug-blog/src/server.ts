/**
 * Fastify + Pug + remark Markdown rendering + LaikaCMS.
 *
 * Three things this starter shows that others don't:
 *
 *   1. Pug template engine via @fastify/view — indentation-based syntax,
 *      template inheritance (`extends`/`block`), mixins. Common in Express
 *      and Fastify apps in the Node.js ecosystem.
 *
 *   2. @fastify/view plugin system — Fastify's plugin-based architecture
 *      vs Express middleware. Plugins are registered with `fastify.register()`
 *      and compose via hooks; reply.view() is added by the plugin.
 *
 *   3. Fastify content-type parser trick for raw body buffering —
 *      required for forwarding request bodies to laika.fetch.
 *      Fastify parses bodies automatically; catch-all parser with
 *      `parseAs: 'buffer'` preserves the raw bytes.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import Fastify from 'fastify';
import { collectStream, runTask } from 'laikacms/compat';
import pug from 'pug';

import { laika } from './laika.js';
import { renderMarkdown } from './md.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const fastify = Fastify({ logger: false });

// Register @fastify/view with Pug before routes so reply.view() is available.
// `root` is relative to cwd(); here we point to the views/ directory.
await fastify.register(fastifyView, {
  engine: { pug },
  root: resolve(process.cwd(), 'views'),
  viewExt: 'pug',
});

// Catch-all content-type parser — buffers every request body as raw bytes.
// Without this, Fastify would parse JSON/form bodies into objects, losing the
// byte stream that laika.fetch needs.
fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body as Buffer);
});

// Decap JSON:API proxy — bridge Fastify req to WHATWG Request.
fastify.all('/api/decap/*', async (request, reply) => {
  const host = request.headers.host ?? 'localhost';
  const url = new URL(request.raw.url ?? '/', `http://${host}`);

  const rawBody = request.body as Buffer | null | undefined;
  let body: ArrayBuffer | undefined;
  if (rawBody && rawBody.byteLength > 0) {
    body = rawBody.buffer.slice(
      rawBody.byteOffset,
      rawBody.byteOffset + rawBody.byteLength,
    ) as ArrayBuffer;
  }

  const webReq = new Request(url.toString(), {
    method: request.method,
    headers: request.headers as Record<string, string>,
    body,
    ...(body ? { duplex: 'half' } : {}),
  } as RequestInit);

  const webRes = await laika.fetch(webReq);

  const resHeaders: Record<string, string> = {};
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') resHeaders[name] = value;
  });

  return reply
    .status(webRes.status)
    .headers(resHeaders)
    .send(Buffer.from(await webRes.arrayBuffer()));
});

// Blog index.
fastify.get('/', async (_request, reply) => {
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

  return reply.view('index', { posts });
});

// Blog post — renders Markdown body to safe HTML via remark pipeline.
fastify.get('/blog/:slug', async (request, reply) => {
  const { slug } = request.params as { slug: string };

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
    return reply.status(404).view('404', { title: 'Not found' });
  }

  return reply.view('post', { title, date, bodyHtml });
});

// Static files — serves /admin/, /uploads/, etc.
// Registered after routes to avoid shadowing /api/decap/*.
await fastify.register(fastifyStatic, {
  root: resolve(process.cwd(), 'public'),
  prefix: '/',
  decorateReply: false,
});

const port = Number(process.env['PORT'] ?? 3000);
fastify.listen({ port }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server running at ${address}`);
});
