import { resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

const fastify = Fastify({ logger: false });

/**
 * Doc gap: Fastify parses request bodies by default (JSON → object, etc.).
 * Parsed bodies replace the original byte stream, so a plain `request.body`
 * in a route handler would be a JavaScript object rather than raw bytes —
 * useless when you need to forward the bytes to laika.fetch.
 *
 * Fix: register a catch-all content-type parser with `parseAs: 'buffer'`
 * BEFORE any routes. This stores the raw bytes as a Buffer in `request.body`
 * for every route, including the /api/decap/* proxy.
 *
 * Alternative: use `addContentTypeParser` per-route inside a scoped plugin,
 * which avoids affecting unrelated routes — but for a starter blog all routes
 * are either GET (no body) or /api/decap/* (needs raw bytes), so global is fine.
 */
fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body as Buffer);
});

/**
 * Decap JSON:API proxy.
 *
 * Bridge Fastify's req/reply to the Web API Request/Response that laika.fetch
 * expects. Fastify does not expose a raw Web API Request — we reconstruct one
 * from the parsed URL + buffered body (captured by the content-type parser above).
 *
 * Note on `duplex: 'half'`: required by the fetch spec when a body is present.
 * TypeScript's lib.dom.d.ts omits this option, so we use `RequestInit` casting.
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
    });

  const items = posts
    .map(post => {
      const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const date = post.updatedAt
        ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
        : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
    })
    .join('\n      ');

  const body = posts.length === 0
    ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
    : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

  return reply.type('text/html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title></head>
<body>
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`);
});

// Blog post.
fastify.get('/blog/:slug', async (request, reply) => {
  const { slug } = request.params as { slug: string };

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    return reply.status(404).send('Not found');
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

// Static files from public/ — serves /admin/index.html, /admin/bundle.js, /uploads/*, etc.
// Register after API routes so the wildcard static handler doesn't shadow /api/decap/*.
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
  console.log(`Fastify blog running at ${address}`);
  console.log(`  Blog:  ${address}/`);
  console.log(`  Admin: ${address}/admin/`);
});
