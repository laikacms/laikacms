import { resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { ADMIN_HTML, laika } from './laika.js';

const fastify = Fastify({ logger: false });

/**
 * Fastify parses request bodies by default, replacing the raw byte stream.
 * Register a catch-all buffer parser so /api/decap/* receives raw bytes that
 * can be forwarded to laika.fetch via a Web API Request.
 *
 * Doc gap: this is required for any Fastify+LaikaCMS integration — Fastify's
 * built-in JSON parser would consume the body before the laika proxy can read it.
 */
fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body as Buffer);
});

/**
 * Decap JSON:API proxy.
 *
 * Fastify does not expose a Web API Request — reconstruct one from the parsed
 * URL and buffered body. `duplex: 'half'` is required by the fetch spec when a
 * body is present; TypeScript's lib.dom.d.ts omits it so we cast RequestInit.
 */
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

// Admin UI — served inline; no esbuild step needed with decapAdminHtml().
fastify.get('/admin', async (_request, reply) => {
  return reply.type('text/html').send(ADMIN_HTML);
});

// Blog index
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
    });

  const items = posts
    .map(post => {
      const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const title = (post as { content?: { title?: string } }).content?.title ?? slug;
      const date = post.updatedAt
        ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
        : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${title}</a>${date}</li>`;
    })
    .join('\n      ');

  const body = posts.length === 0
    ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
    : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

  return reply.type('text/html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog · Fastify + Turso</title></head>
<body>
  <h1>My Blog</h1>
  <p><small>Storage: LibSqlStorageRepository / Turso</small></p>
  ${body}
  <p><a href="/admin">Admin →</a></p>
</body>
</html>`);
});

// Individual post
fastify.get('/blog/:slug', async (request, reply) => {
  const { slug } = request.params as { slug: string };

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof NotFoundError) return reply.status(404).send('Post not found');
    throw err;
  }

  const { title, date, description, body } = post.content as {
    title?: string,
    date?: string,
    description?: string,
    body?: string,
  };

  return reply.type('text/html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title></head>
<body>
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`);
});

// Static files for media uploads — register after API routes
await fastify.register(fastifyStatic, {
  root: resolve(process.cwd(), 'public'),
  prefix: '/',
  decorateReply: false,
});

const PORT = Number(process.env['PORT'] ?? 3000);
fastify.listen({ port: PORT }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Fastify + Turso blog running at ${address}`);
  console.log(`  Blog:    ${address}/`);
  console.log(`  Admin:   ${address}/admin`);
});
