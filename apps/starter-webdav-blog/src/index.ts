import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { startDevWebDav } from './dev-webdav.js';
import { laika } from './laika.js';

// Start an embedded WebDAV server unless WEBDAV_URL points somewhere external.
if (!process.env['WEBDAV_URL']) {
  startDevWebDav(4918);
}

const app = new Hono();

app.all('/api/decap/*', c => laika.fetch(c.req.raw));

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
      const date = post.updatedAt
        ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
        : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
    })
    .join('\n      ');

  const body = posts.length === 0
    ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
    : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

  const webdavUrl = process.env['WEBDAV_URL'] ?? 'http://localhost:4918 (embedded dev server)';

  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog · WebDAV</title></head>
<body>
  <h1>My Blog</h1>
  <p><small>WebDAV: ${webdavUrl}</small></p>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
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

app.use('/*', serveStatic({ root: './public' }));

const PORT = Number(process.env['PORT'] ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`WebDAV blog running at http://localhost:${info.port}`);
  console.log(`  Blog:  http://localhost:${info.port}/`);
  console.log(`  Admin: http://localhost:${info.port}/admin/`);
  if (!process.env['WEBDAV_URL']) {
    console.log('  (Content stored in ./webdav-content/ via embedded WebDAV)');
    console.log('  Set WEBDAV_URL to use a real WebDAV server instead.');
  }
});
