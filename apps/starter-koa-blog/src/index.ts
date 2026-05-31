import { createServer } from 'node:http';

import Router from '@koa/router';
import Koa from 'koa';
import koaStatic from 'koa-static';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

/**
 * Bridge a Koa context to a Web API Request so laika.fetch can handle it.
 *
 * Koa wraps Node.js IncomingMessage in ctx.req — it is NOT a WHATWG Request.
 * laika.fetch expects a Web API Request, so we reconstruct one from the raw
 * stream. This is the same pattern needed for Express and Fastify.
 *
 * Doc gap: laika.fetch takes a Web API Request, not Node's IncomingMessage.
 * WHATWG-native frameworks (Hono, Elysia, Remix, Astro) need no adapter.
 * Koa, Express, Fastify, and NestJS/Express do — document this pattern.
 */
async function toLaikaRequest(ctx: Koa.Context): Promise<Request> {
  const host = ctx.headers.host ?? 'localhost';
  const url = new URL(ctx.url, `http://${host}`);

  let body: ArrayBuffer | undefined;
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    const chunks: Uint8Array[] = [];
    for await (const chunk of ctx.req) chunks.push(new Uint8Array(chunk as Buffer));
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    if (total > 0) {
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      body = merged.buffer;
    }
  }

  return new Request(url, {
    method: ctx.method,
    headers: ctx.headers as Record<string, string>,
    body,
  });
}

const app = new Koa();
const router = new Router();

// Decap JSON:API — proxy /api/decap/* to laika.
router.all('/api/decap/(.*)', async ctx => {
  const webReq = await toLaikaRequest(ctx);
  const webRes = await laika.fetch(webReq);

  ctx.status = webRes.status;
  webRes.headers.forEach((value: string, name: string) => {
    if (name.toLowerCase() !== 'transfer-encoding') ctx.set(name, value);
  });
  ctx.body = Buffer.from(await webRes.arrayBuffer());
});

// Blog index.
router.get('/', async ctx => {
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  type PostSummary = { type: string, key: string, updatedAt?: string };

  const posts = (records as PostSummary[])
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

  ctx.type = 'html';
  ctx.body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title></head>
<body>
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`;
});

// Blog post.
router.get('/blog/:slug', async ctx => {
  const { slug } = ctx.params;
  try {
    const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const { title, date, description, body } = post.content as {
      title?: string,
      date?: string,
      description?: string,
      body?: string,
    };

    ctx.type = 'html';
    ctx.body = `<!doctype html>
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
</html>`;
  } catch {
    ctx.status = 404;
    ctx.body = 'Not found';
  }
});

app
  .use(router.routes())
  .use(router.allowedMethods())
  .use(koaStatic('public'));

const PORT = Number(process.env.PORT ?? 3000);
createServer(app.callback()).listen(PORT, () => {
  console.log(`Koa blog running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
});
