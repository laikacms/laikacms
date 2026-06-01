import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';

import { decapAdminHtml, decapConfig, laika } from './laika.js';

const app = new Hono();

const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS Hygraph starter' });

app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.get('/admin/', c => c.html(ADMIN_HTML));
app.get('/admin', c => c.redirect('/admin/'));

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
      const date = post.updatedAt ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>` : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
    })
    .join('\n      ');

  const body = posts.length === 0
    ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
    : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog · Hygraph</title></head>
<body>
  <h1>My Blog</h1>
  <p style="color:#888">Backed by Hygraph — GraphQL queries, stage-aware reads</p>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`);
});

app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();
  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    return c.notFound();
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

const PORT = Number(process.env['PORT'] ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Hygraph blog running at http://localhost:${info.port}`);
  console.log(`  Blog:  http://localhost:${info.port}/`);
  console.log(`  Admin: http://localhost:${info.port}/admin/`);
});
