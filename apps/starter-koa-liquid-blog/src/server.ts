/**
 * Koa + LiquidJS + remark Markdown rendering + LaikaCMS.
 *
 * Three things this starter shows that others don't:
 *
 *   1. LiquidJS template engine — Shopify's Liquid language for Node.js.
 *      Used by Jekyll, GitHub Pages, and Eleventy. Sandboxed: templates
 *      cannot execute arbitrary JavaScript, only use registered filters/tags.
 *      Liquid inherits layouts via {% layout 'base' %} / {% block content %}.
 *
 *   2. Direct LiquidJS integration with Koa — no special middleware required.
 *      `liquid.renderFile(template, vars)` returns a Promise<string> that
 *      maps cleanly to Koa's async context: `ctx.body = await liquid.renderFile(...)`.
 *
 *   3. Koa async body buffering for laika.fetch — iterating the raw
 *      IncomingMessage stream with `for await (const chunk of ctx.req)`.
 *      Koa does not expose a raw body buffer or WHATWG Request; we
 *      reconstruct the request manually.
 */
import { createServer } from 'node:http';

import Router from '@koa/router';
import Koa from 'koa';
import koaStatic from 'koa-static';
import { collectStream, runTask } from 'laikacms/compat';
import { Liquid } from 'liquidjs';

import { laika } from './laika.js';
import { renderMarkdown } from './md.js';

const app = new Koa();
const router = new Router();

// Configure LiquidJS to load templates from views/.
// `root` is relative to process.cwd(); `extname` sets the default extension.
//
// Doc gap: LiquidJS does NOT auto-escape HTML by default — unlike Nunjucks,
// Jinja2, and Pug which escape {{ }} output. This means {{ bodyHtml }} outputs
// raw HTML, which is what we want for pre-rendered Markdown. For user-controlled
// strings you'd want to call escape() yourself or pass `outputEscape: 'escape'`
// and use {{ value | raw }} — but note there is no built-in `raw` filter that
// bypasses `outputEscape`; the workaround is to register a custom tag.
const liquid = new Liquid({
  root: 'views',
  extname: '.liquid',
  cache: process.env['NODE_ENV'] === 'production',
});

// Bridge a Koa context to a WHATWG Request for laika.fetch.
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
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      body = merged.buffer as ArrayBuffer;
    }
  }

  return new Request(url.toString(), {
    method: ctx.method,
    headers: ctx.headers as Record<string, string>,
    body,
    ...(body ? { duplex: 'half' } : {}),
  } as RequestInit);
}

// Decap JSON:API proxy.
router.all('/api/decap/(.*)', async ctx => {
  const webReq = await toLaikaRequest(ctx);
  const webRes = await laika.fetch(webReq);

  ctx.status = webRes.status;
  webRes.headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'transfer-encoding') ctx.set(k, v);
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

  ctx.body = await liquid.renderFile('index', { title: 'My Blog', posts });
  ctx.type = 'text/html';
});

// Blog post — renders Markdown body to safe HTML via remark pipeline.
router.get('/blog/:slug', async ctx => {
  const { slug } = ctx.params;

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
    ctx.status = 404;
    ctx.body = await liquid.renderFile('404', { title: 'Not found' });
    ctx.type = 'text/html';
    return;
  }

  ctx.body = await liquid.renderFile('post', { title, date, bodyHtml });
  ctx.type = 'text/html';
});

app
  .use(router.routes())
  .use(router.allowedMethods())
  .use(koaStatic('public'));

const port = Number(process.env['PORT'] ?? 3000);
createServer(app.callback()).listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
