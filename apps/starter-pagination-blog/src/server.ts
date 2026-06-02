import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { decapConfig, laika } from './laika.js';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';

const PER_PAGE = 5;

const app = new Hono();

// ── Decap JSON:API ────────────────────────────────────────────────────────────
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// ── Blog index with pagination ────────────────────────────────────────────────
//
// collectStream returns { items, done } where:
//   done.total       — total matching records (from the storage layer)
//   done.pagination  — hint for the next page (omitted when on the last page)
//
// Page-based pagination: { page: N, perPage: N }
// Offset-based:          { offset: N, limit: N }
// Both are supported by FileSystemStorageRepository.
app.get('/', async c => {
  const page = Math.max(1, Number(c.req.query('page') ?? 1));

  const { items, done } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page, perPage: PER_PAGE },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  const posts = items.filter(r => r.type === 'published-summary');
  const total = done.total ?? posts.length;
  const totalPages = Math.ceil(total / PER_PAGE);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const rows = posts.map(post => {
    const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
    const date = post.updatedAt
      ? `<time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
      : '';
    return `<li>
      <a href="/blog/${slug}">${slug}</a>
      ${date}
    </li>`;
  });

  const emptyMsg = total === 0
    ? `<p>No posts yet. <a href="/admin/">Open the CMS</a> to write some.</p>`
    : '';

  const pager = totalPages > 1
    ? `<nav aria-label="Pagination" style="display:flex;gap:1rem;align-items:center;margin-top:1.5rem">
        ${hasPrev ? `<a href="/?page=${page - 1}">← Previous</a>` : '<span style="color:#aaa">← Previous</span>'}
        <span>Page ${page} of ${totalPages} (${total} posts)</span>
        ${hasNext ? `<a href="/?page=${page + 1}">Next →</a>` : '<span style="color:#aaa">Next →</span>'}
      </nav>`
    : `<p style="color:#666;font-size:.875rem">${total} post${total === 1 ? '' : 's'} total</p>`;

  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Paginated Blog</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
    ul { list-style: none; padding: 0; }
    li { margin: .75rem 0; display: flex; gap: .75rem; align-items: baseline; }
    time { color: #666; font-size: .875rem; }
    nav a { color: inherit; }
  </style>
</head>
<body>
  <h1>Paginated Blog</h1>
  ${emptyMsg}
  <ul>${rows.join('')}</ul>
  ${pager}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`);
});

// ── Single post ───────────────────────────────────────────────────────────────
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();
  const page = c.req.query('from') ?? '1';

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof NotFoundError) return c.notFound();
    throw err;
  }

  const { title, date, body } = post.content as {
    title?: string,
    date?: string,
    body?: string,
  };

  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title ?? slug}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  </style>
</head>
<body>
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/?page=${page}">← Back to page ${page}</a></p>
</body>
</html>`);
});

// ── Admin ─────────────────────────────────────────────────────────────────────
app.get('/admin', c => c.html(decapAdminHtml({ decapConfig })));
app.get('/admin/', c => c.html(decapAdminHtml({ decapConfig })));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Paginated blog at http://localhost:${info.port}`);
  console.log(`  Blog:  http://localhost:${info.port}/`);
  console.log(`  Admin: http://localhost:${info.port}/admin/`);
  console.log(`  (${PER_PAGE} posts per page)`);
});
