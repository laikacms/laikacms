/**
 * Bun native HTTP server + LaikaCMS.
 *
 * Bun.serve() uses WHATWG Request/Response natively, so laika.fetch(request)
 * requires zero adaptation — the cleanest possible integration.
 *
 * Routes:
 *   /api/decap/*  → laika.fetch (Decap JSON:API)
 *   /admin        → Decap CMS admin HTML (client bundle from public/admin/)
 *   /blog/:slug   → blog post detail
 *   /             → blog homepage
 *   /*            → static files from public/
 */
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)}</title>
  <style>body{max-width:48rem;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif}</style>
</head>
<body>
  <nav><a href="/" style="font-weight:bold;text-decoration:none">My Blog</a> · <a href="/admin">CMS</a></nav>
  ${body}
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

async function homePage(): Promise<Response> {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  type S = { key: string, updatedAt?: string, type: string };
  const posts = (items as S[])
    .filter(r => r.type === 'published-summary')
    .map(r => ({ slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''), updatedAt: r.updatedAt }))
    .sort((a, b) => (b.updatedAt ?? b.slug).localeCompare(a.updatedAt ?? a.slug));

  const list = posts.length === 0
    ? `<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>`
    : `<ul style="list-style:none;padding:0">${
      posts.map(p =>
        `<li style="margin-bottom:1.5rem"><a href="/blog/${escHtml(p.slug)}">${escHtml(p.slug)}</a>${
          p.updatedAt ? ` · <time>${new Date(p.updatedAt).toLocaleDateString()}</time>` : ''
        }</li>`
      ).join('')
    }</ul>`;

  return page('My Blog', `<h1>My Blog</h1>${list}`);
}

async function blogPost(slug: string): Promise<Response> {
  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    return page('Not Found', '<h1>Post not found</h1><p><a href="/">← Back</a></p>');
  }

  const { title, date, description, body } = post.content as {
    title?: string,
    date?: string,
    description?: string,
    body?: string,
  };

  return page(
    title ?? slug,
    `<article>
  <h1>${escHtml(title ?? slug)}</h1>
  ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
  ${description ? `<p><em>${escHtml(description)}</em></p>` : ''}
  <pre style="white-space:pre-wrap;font-family:inherit">${escHtml(body ?? '')}</pre>
  <p><a href="/">← Back</a></p>
</article>`,
  );
}

function adminPage(): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Content Manager</title>
  <script type="module" src="/admin/index.js"></script>
</head>
<body></body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path.startsWith('/api/decap')) {
      return laika.fetch(req);
    }

    if (path === '/admin' || path === '/admin/') {
      return adminPage();
    }

    const slugMatch = path.match(/^\/blog\/([^/]+)\/?$/);
    if (slugMatch) {
      return blogPost(slugMatch[1]!);
    }

    if (path === '/' || path === '') {
      return homePage();
    }

    const file = Bun.file(`./public${path}`);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(`Blog:  http://localhost:${PORT}`);
console.log(`Admin: http://localhost:${PORT}/admin`);
