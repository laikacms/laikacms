/**
 * Hono on Bun — native Bun HTTP server, no @hono/node-server adapter.
 *
 * Pattern: export default { port, fetch: app.fetch }
 * Bun picks up the default export and calls fetch() for every incoming request.
 * This is the same zero-adapter model as Bun.serve({ fetch }) — just Hono's
 * routing layer on top.
 *
 * Contrast with starter-hono-blog (Node, uses @hono/node-server) and
 * starter-bun-blog (Bun.serve directly, no Hono).
 *
 * serveStatic from hono/bun reads files via Bun's filesystem APIs.
 * laika.fetch(c.req.raw) works without bridging: Bun passes WHATWG Requests.
 */
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const app = new Hono();

// Decap JSON:API — Bun passes WHATWG Requests, so no bridging needed.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Static files (uploads, admin bundle)
app.use('/uploads/*', serveStatic({ root: './public' }));
app.use('/admin/*', serveStatic({ root: './public' }));

// Blog index
app.get('/', async () => {
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
    .map(r => {
      const slug = r.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const date = r.updatedAt ? ` · <time>${new Date(r.updatedAt).toLocaleDateString()}</time>` : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${escHtml(slug)}">${escHtml(slug)}</a>${date}</li>`;
    })
    .join('\n');

  const body = posts.length === 0
    ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
    : `<ul style="list-style:none;padding:0">\n${items}\n</ul>`;

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>My Blog</title></head>
<body style="font-family:system-ui;max-width:48rem;margin:2rem auto;padding:0 1rem">
<nav style="margin-bottom:2rem"><a href="/">Home</a> · <a href="/admin/">Admin</a></nav>
<h1>My Blog</h1>${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
});

// Blog post
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();

  let content: { title?: string, body?: string };
  try {
    const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    content = post.content as { title?: string, body?: string };
  } catch {
    return c.notFound();
  }

  const title = content.title ?? slug;
  const rawBody = content.body ?? '';

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escHtml(title)}</title></head>
<body style="font-family:system-ui;max-width:48rem;margin:2rem auto;padding:0 1rem">
<nav style="margin-bottom:2rem"><a href="/">Home</a> · <a href="/admin/">Admin</a></nav>
<h1>${escHtml(title)}</h1><pre style="white-space:pre-wrap;font-family:inherit">${escHtml(rawBody)}</pre>
<p><a href="/">← Back</a></p></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
});

const port = Number(process.env['PORT'] ?? 3000);

// Bun picks up export default { port, fetch } — no serve() call needed.
export default { port, fetch: app.fetch };
