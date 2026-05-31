import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { serve } from '@hono/node-server';
import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

// Render injects $PORT (10000 by default per their docs). Honor it.
const PORT = Number(process.env.PORT ?? 10000);
const CONTENT_DIR = resolve(process.env.CONTENT_DIR ?? './content');

// Render persistent disks attach empty on first deploy. Ensure the parent
// exists so createEmbeddedLaika's mkdirSync succeeds.
try {
  mkdirSync(CONTENT_DIR, { recursive: true });
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('Could not pre-create CONTENT_DIR:', err);
}

const decapConfig = minimalBlogConfig();
const laika = createEmbeddedLaika({
  contentDir: CONTENT_DIR,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS Render.com starter' });

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-render',
    runtime: `Node.js ${process.version}`,
    storage: `FileSystem @ ${CONTENT_DIR} (Render persistent disk in production)`,
    instance: process.env.RENDER_INSTANCE_ID ?? 'local',
    region: process.env.RENDER_REGION ?? 'local',
    endpoints: {
      'GET /': 'this index (also the health check)',
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

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Render.com backend listening on http://0.0.0.0:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`Content directory: ${CONTENT_DIR}`);
});
