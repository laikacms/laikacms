import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import type { RecordSummary } from 'laikacms/documents';

import { laika } from './laika.js';

const app = new Hono();

// Decap JSON:API
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Blog index
app.get('/', async c => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  const posts = (items as RecordSummary[])
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });

  const listItems = posts
    .map(post => {
      const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const date = post.updatedAt
        ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
        : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
    })
    .join('\n      ');

  const body = posts.length === 0
    ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
    : `<ul style="list-style:none;padding:0">\n      ${listItems}\n    </ul>`;

  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>My Blog</title>
  <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}a{color:#0070f3}</style>
</head>
<body>
  <nav><a href="/">Home</a> · <a href="/admin/">Admin</a></nav>
  <h1>My Blog</h1>
  ${body}
</body>
</html>`);
});

// Individual blog post
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();

  try {
    const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const data = post.content as Record<string, unknown>;
    const title = typeof data.title === 'string' ? data.title : slug;
    const body = typeof data.body === 'string' ? data.body : '';
    const date = typeof data.date === 'string'
      ? `<p><time>${new Date(data.date).toLocaleDateString()}</time></p>`
      : '';

    return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}a{color:#0070f3}</style>
</head>
<body>
  <nav><a href="/">Home</a> · <a href="/admin/">Admin</a></nav>
  <article>
    <h1>${title}</h1>
    ${date}
    <pre style="white-space:pre-wrap">${body}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`);
  } catch {
    return c.html('<h1>Post not found</h1><p><a href="/">← Back</a></p>', 404);
  }
});

// Static admin UI
app.use('/admin/*', serveStatic({ root: './public' }));
app.use('/admin', serveStatic({ root: './public' }));

const port = Number(process.env.PORT ?? 3000);
console.log(`starter-mongodb-blog listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
