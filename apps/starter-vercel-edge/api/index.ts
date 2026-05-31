import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { createWorkersLaika } from '@laikacms/decap-integrations/workers';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { createVercelBlobBucket } from './blob-r2-adapter';

export const config = { runtime: 'edge' };

const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS Vercel Edge starter' });

const makeLaika = () =>
  createWorkersLaika({
    bucket: createVercelBlobBucket(),
    decapConfig,
    basePath: '/api/decap',
    seedConfigOnFirstRequest: true,
    auth: { mode: 'dev' },
  });

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-vercel-edge',
    runtime: 'Vercel Edge (V8 isolates)',
    note: 'Proof-of-concept: Vercel Blob does not implement the full R2 surface. See README.',
    endpoints: {
      'GET /': 'this index',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
      'GET /posts': 'public list of published posts',
      'GET /posts/:slug': 'public single-post endpoint',
    },
  }));

app.get('/admin', c => c.html(ADMIN_HTML));

app.all('/api/decap/*', c => makeLaika().fetch(c.req.raw));

app.get('/posts', async c => {
  const { items } = await collectStream(
    makeLaika().documents.listRecords({
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
    const doc = await runTask(makeLaika().documents.getDocument(`posts/${c.req.param('slug')}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

export default app.fetch;
