import { resolve } from 'node:path';

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { createDrizzleStorage } from './db/repo.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const DB_URL = process.env['DB_URL'] ?? `file:${resolve(process.cwd(), 'laikacms.db')}`;

// DrizzleStorageRepository requires async setup (CREATE TABLE on boot).
// createCustomLaika takes any StorageRepository, so we await here and pass it in.
// This is the "BYO storage" pattern — use when the specialized presets
// (createEmbeddedLaika / createWorkersLaika) don't fit your storage choice.
const storage = await createDrizzleStorage(DB_URL);

const decapConfig = minimalBlogConfig();

const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

// decapAdminHtml() generates the entire admin page as a string — no separate
// esbuild step or public/admin/index.html needed. The Decap config is inlined
// into the page's inline script at server startup.
const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · Drizzle SQLite Blog',
});

const app = new Hono();

// Decap JSON:API — forward all /api/decap/* to laika.fetch.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Admin UI — served from a route, not from a static file.
app.get('/admin', c => c.html(ADMIN_HTML));

// Blog index
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
<head><meta charset="utf-8"><title>My Blog · Drizzle SQLite</title></head>
<body>
  <h1>My Blog</h1>
  <p><small>Storage: DrizzleStorageRepository / libsql @ ${DB_URL}</small></p>
  ${body}
  <p><a href="/admin">Admin →</a></p>
</body>
</html>`);
});

// Individual post
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

// Static files (uploads)
app.use('/*', serveStatic({ root: './public' }));

serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Drizzle SQLite blog running at http://localhost:${info.port}`);
  console.log(`  Blog:    http://localhost:${info.port}/`);
  console.log(`  Admin:   http://localhost:${info.port}/admin`);
  console.log(`  DB:      ${DB_URL}`);
});
