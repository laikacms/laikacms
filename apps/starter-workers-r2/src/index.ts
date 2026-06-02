import { createWorkersLaika } from '@laikacms/decap-integrations/workers';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { ADMIN_HTML } from './admin.js';
import { decapConfig } from './decap-config.js';

interface Env {
  CONTENT: R2Bucket;
}

// One LaikaCMS instance per request — Workers tear down isolates between
// requests anyway, and the R2 bindings are per-request. The setup cost is
// just a few object allocations.
const makeLaika = (env: Env) =>
  createWorkersLaika({
    bucket: env.CONTENT,
    decapConfig,
    basePath: '/api/decap',
    seedConfigOnFirstRequest: true,
    auth: { mode: 'dev' },
  });

const app = new Hono<{ Bindings: Env }>();

// Endpoint index.
app.get('/', c =>
  c.json({
    name: '@laikacms/starter-workers-r2',
    endpoints: {
      'GET /': 'this index',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
      'GET /posts': 'sample public read endpoint',
      'GET /posts/:slug': 'sample single-post endpoint',
    },
  }));

app.get('/admin', c => c.html(ADMIN_HTML));

app.all('/api/decap/*', c => {
  const laika = makeLaika(c.env);
  return laika.fetch(c.req.raw);
});

app.get('/posts', async c => {
  const laika = makeLaika(c.env);
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
  const laika = makeLaika(c.env);
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

export default app;
