/**
 * Pages Functions catch-all. Cloudflare Pages routes any request matching
 * `/api/*` to this file. We delegate to a Hono app inside.
 *
 * The interesting bit: this file runs in Cloudflare's V8 isolate runtime —
 * same as Workers. So `createWorkersLaika` + R2 binding work unchanged.
 * The difference from `apps/starter-workers-r2` is the deployment shape:
 * Pages auto-serves static assets from `public/` and only invokes Functions
 * for paths that DON'T match a static asset.
 */
import { createWorkersLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/workers';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

interface Env {
  CONTENT: R2Bucket;
}

const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS Pages starter' });

const app = new Hono<{ Bindings: Env }>();

const makeLaika = (env: Env) =>
  createWorkersLaika({
    bucket: env.CONTENT,
    decapConfig,
    basePath: '/api/decap',
    seedConfigOnFirstRequest: true,
    auth: { mode: 'dev' },
  });

app.get('/api', c =>
  c.json({
    name: '@laikacms/starter-cloudflare-pages',
    runtime: 'Cloudflare Pages Functions (V8 isolates)',
    endpoints: {
      'GET /': 'static index.html from public/',
      'GET /admin': 'static admin.html (also routes through /api in dev)',
      'GET /api': 'this index',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
      'GET /api/posts': 'public list of published posts',
      'GET /api/posts/:slug': 'public single-post endpoint',
    },
  }));

app.get('/api/admin', c => c.html(ADMIN_HTML));

app.all('/api/decap/*', c => makeLaika(c.env).fetch(c.req.raw));

app.get('/api/posts', async c => {
  const { items } = await collectStream(
    makeLaika(c.env).documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return c.json({
    posts: items
      .filter(item => item.type === 'published')
      .map(item => ({
        key: (item as { key: string }).key,
        content: (item as { content?: unknown }).content,
      })),
  });
});

app.get('/api/posts/:slug', async c => {
  try {
    const doc = await runTask(makeLaika(c.env).documents.getDocument(`posts/${c.req.param('slug')}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

export const onRequest: PagesFunction<Env> = ctx => app.fetch(ctx.request, ctx.env);
