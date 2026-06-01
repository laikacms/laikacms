import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { decapAdminHtml, decapConfig, laika } from './laika.js';

const app = new Hono();

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS GitHub Gist starter',
});

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-gist-blog',
    storage: `GitHub Gist (id: ${process.env['GIST_ID'] ?? '?'})`,
    note: 'All writes go through PATCH /gists/{id} — atomic multi-file delta in one request.',
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
  console.log(`LaikaCMS GitHub Gist blog running at http://localhost:${info.port}`);
  console.log(`  Admin: http://localhost:${info.port}/admin`);
  console.log(`  Posts: http://localhost:${info.port}/posts`);
  console.log(`  Gist:  https://gist.github.com/${process.env['GIST_ID'] ?? '?'}`);
});
