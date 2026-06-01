import { serve } from '@hono/node-server';
import { decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { decapConfig, laika } from './laika.js';

const app = new Hono();

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Backblaze B2 starter',
});

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-backblaze-blog',
    storage: `Backblaze B2 native API (bucket: ${process.env['B2_BUCKET_NAME'] ?? '?'})`,
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
  type PublishedRecord = { type: string, key: string, content?: unknown };
  return c.json({
    posts: (items as PublishedRecord[])
      .filter(item => item.type === 'published')
      .map(item => ({ key: item.key, content: item.content })),
  });
});

app.get('/posts/:slug', async c => {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${c.req.param('slug')}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.notFound();
    throw err;
  }
});

const PORT = Number(process.env['PORT'] ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`LaikaCMS Backblaze B2 blog running at http://localhost:${info.port}`);
  console.log(`  Admin: http://localhost:${info.port}/admin`);
  console.log(`  Posts: http://localhost:${info.port}/posts`);
});
