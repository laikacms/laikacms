/**
 * Oak blog server.
 *
 * Oak is Deno's most popular HTTP middleware framework. It wraps
 * Deno.serve() with a Connect-style middleware chain and a URLPattern
 * router — similar to Express but built for Deno's WHATWG-native runtime.
 *
 * Bridging Oak → laika.fetch
 * ─────────────────────────
 * Oak wraps the native Deno Request in its own `oak.Request` type,
 * so we cannot pass `ctx.request` directly to `laika.fetch`. Instead
 * we reconstruct a WHATWG Request from Oak's context:
 *
 *   const body = ctx.request.hasBody
 *     ? await ctx.request.body.arrayBuffer()
 *     : null;
 *   const req = new Request(ctx.request.url.href, {
 *     method: ctx.request.method,
 *     headers: ctx.request.headers,
 *     body: body?.byteLength ? body : null,
 *   });
 *
 * The response body (a ReadableStream) is piped straight into
 * ctx.response.body — Oak will stream it out without buffering.
 *
 * Compare to Hono / Elysia which surface the native Request directly,
 * and to Express / Fastify which need a full IncomingMessage adapter.
 *
 * Required Deno permissions (set in deno.json tasks):
 *   --allow-net   HTTP server + outbound fetch
 *   --allow-read  Read content/ and public/ directories
 *   --allow-write Write content/ files (Decap CRUD)
 */
import { Application, type Context, Router } from '@oak/oak';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { ADMIN_HTML, laika } from './lib/laika.ts';

const PORT = Number(Deno.env.get('PORT') ?? 3000);

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

// ── Decap JSON:API proxy ──────────────────────────────────────────────────────
// Oak wraps the native Deno Request in its own type; we reconstruct a
// WHATWG Request so laika.fetch receives exactly what it expects.
async function proxyToLaika(ctx: Context): Promise<void> {
  const body = ctx.request.hasBody ? await ctx.request.body.arrayBuffer() : null;
  const req = new Request(ctx.request.url.href, {
    method: ctx.request.method,
    headers: ctx.request.headers,
    body: body && body.byteLength > 0 ? body : null,
  });
  const res = await laika.fetch(req);
  ctx.response.status = res.status;
  res.headers.forEach((v: string, k: string) => ctx.response.headers.set(k, v));
  ctx.response.body = res.body ?? new Uint8Array(0);
}

// ── Router ────────────────────────────────────────────────────────────────────
const router = new Router();

// Decap admin UI (HTML generated from CDN template — no esbuild needed).
router.get('/admin/', ctx => {
  ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8');
  ctx.response.body = ADMIN_HTML;
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

  const bodyHtml = posts.length === 0
    ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
    : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

  ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8');
  ctx.response.body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title></head>
<body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
  <h1>My Blog</h1>
  ${bodyHtml}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`;
});

// Individual post.
router.get('/blog/:slug', async ctx => {
  const slug = ctx.params.slug;

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof NotFoundError) {
      ctx.response.status = 404;
      ctx.response.body = 'Not Found';
      return;
    }
    throw err;
  }

  const { title, date, description, body } = post.content as PostContent;

  ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8');
  ctx.response.body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time style="color:#666">${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
    <p><a href="/">← Back</a></p>
  </article>
</body>
</html>`;
});

// ── Application ───────────────────────────────────────────────────────────────
const app = new Application();

// Intercept /api/decap/* before routing — Oak's URLPattern router doesn't
// handle wildcard suffixes well with middleware ordering, so a plain
// pathname check in a top-level middleware is more reliable.
app.use(async (ctx, next) => {
  if (ctx.request.url.pathname.startsWith('/api/decap')) {
    await proxyToLaika(ctx);
    return;
  }
  return next();
});

app.use(router.routes());
app.use(router.allowedMethods());

// 404 fallback.
app.use(ctx => {
  ctx.response.status = 404;
  ctx.response.body = 'Not Found';
});

console.log(`Blog:  http://localhost:${PORT}`);
console.log(`Admin: http://localhost:${PORT}/admin/`);

await app.listen({ port: PORT });
