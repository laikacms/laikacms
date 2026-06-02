import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import type { Context } from '@netlify/functions';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

const decapConfig = minimalBlogConfig();

/*
 * Storage caveat — read carefully before deploying:
 *
 * Netlify Functions (Node runtime) have a writable but **ephemeral** /tmp
 * filesystem. `createEmbeddedLaika` works for the lifetime of one function
 * instance, but anything written gets wiped on cold start. That's fine for a
 * dev sandbox; useless for a production CMS.
 *
 * The right answer on Netlify is **Netlify Blobs** — a durable key-value
 * store. Wire it up by writing a small StorageRepository adapter (see
 * `@laikacms/storage-r2` for a template) and pass it to the lower-level
 * `decapApi(...)` instead of going through the embedded preset. The roadmap
 * note in docs/starters.md tracks this gap.
 *
 * For now: the function uses /tmp + bundled seed content so the routes
 * resolve and the JSON:API responds. Don't trust writes to persist.
 */
const contentDir = resolve(tmpdir(), 'laikacms-content');

const laika = createEmbeddedLaika({
  contentDir,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Netlify Functions starter',
});

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-netlify-functions',
    runtime: 'Netlify Functions (Node)',
    storage: 'EPHEMERAL /tmp — see README for Netlify Blobs migration',
    endpoints: {
      'GET /': 'this index',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
      'GET /posts': 'public list of published posts',
      'GET /posts/:slug': 'public single-post endpoint',
    },
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.get('/posts', async c => {
  const { items } = await collectStream(
    laika.documents.listRecords({
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

app.get('/posts/:slug', async c => {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${c.req.param('slug')}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

// Netlify Functions v2: default export receives `(Request, Context)` and
// returns a `Response`. Just delegate to Hono.
export default async function handler(request: Request, _context: Context) {
  return app.fetch(request);
}

export const config = { path: '/*' };
