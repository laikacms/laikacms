import { serve } from '@hono/node-server';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { createNeonStorage } from './db/repo.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and fill in your Neon connection string.');
}

// DrizzleStorageRepository requires async setup (CREATE TABLE IF NOT EXISTS).
// Await here; createCustomLaika takes any StorageRepository synchronously.
const storage = await createNeonStorage(DATABASE_URL);

const decapConfig = minimalBlogConfig();

const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · Neon Blog',
});

const app = new Hono();

app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.get('/admin', c => c.html(ADMIN_HTML));

app.get('/', async c => {
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
      const title = (post as { content?: { title?: string } }).content?.title ?? slug;
      const date = post.updatedAt
        ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
        : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${title}</a>${date}</li>`;
    })
    .join('\n      ');

  const body = posts.length === 0
    ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
    : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog · Neon</title></head>
<body>
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin">Admin →</a></p>
</body>
</html>`);
});

app.get('/blog/:slug', async c => {
  const slug = c.req.param('slug');
  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof NotFoundError) return c.notFound();
    throw err;
  }

  const { title, date, description, body } = post.content as {
    title?: string,
    date?: string,
    description?: string,
    body?: string,
  };

  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title></head>
<body>
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`);
});

serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Neon blog running at http://localhost:${info.port}`);
  console.log(`  Admin: http://localhost:${info.port}/admin`);
});
