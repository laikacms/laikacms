import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from './lib/laika.js';

const PORT = Number(process.env.PORT ?? 3000);

const app = new Hono();

// Root: index — quick health + endpoint list.
app.get('/', async c => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return c.json({
    name: '@laikacms/starter-hono-backend',
    endpoints: {
      'GET /': 'this index',
      'GET /admin/': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
      'GET /posts': 'sample read endpoint (no auth, reads directly from the repo)',
      'GET /posts/:slug': 'sample single-post endpoint (no auth)',
    },
    samplePostsCount: items.length,
  });
});

// Mount the LaikaCMS HTTP API. This is what the Decap admin (and any other
// authenticated client) calls.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Sample public read endpoints — show how a custom backend can serve content
// without going through the authenticated HTTP API by calling the repos
// directly via laikacms/compat.
app.get('/posts', async c => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  const posts = items
    .filter(item => item.type === 'published')
    .map(item => ({
      key: (item as { key: string }).key,
      content: (item as { content?: unknown }).content,
    }));
  return c.json({ posts });
});

app.get('/posts/:slug', async c => {
  const slug = c.req.param('slug');
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

// Serve admin shell and bundled assets from public/.
// public/admin/index.html   → GET /admin/
// public/admin/bundle.js    → GET /admin/bundle.js  (built by pnpm build:admin)
app.use('/*', serveStatic({ root: './public' }));

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Hono backend listening on http://localhost:${info.port}`);
});
