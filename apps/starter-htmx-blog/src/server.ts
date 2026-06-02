/**
 * HTMX + Hono SSR blog — hypermedia-driven architecture.
 *
 * HTMX philosophy: the server is the source of truth for UI state.
 * Instead of a JSON API + client-side rendering, routes return HTML fragments
 * that HTMX swaps into the DOM. No client-side JS framework is required.
 *
 * Routes:
 *   GET /              Full page — blog list with HTMX attributes
 *   GET /blog/:slug    Full page — post detail (for direct navigation / SSR)
 *   GET /fragments/post/:slug  HTML fragment — post content only (HTMX target)
 *   ALL /api/decap/*   Decap JSON:API proxy
 *
 * HTMX swap flow:
 *   1. User clicks a post link tagged hx-get="/fragments/post/:slug" hx-target="#content"
 *   2. HTMX fetches /fragments/post/:slug and swaps the response into #content
 *   3. No full page reload — only the article area updates
 *   4. Browser history updates via hx-push-url="/blog/:slug"
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

const app = new Hono();

const HTMX_CDN = 'https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js';

const CSS = `
  body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  a { color: #0070f3; text-decoration: none; }
  a:hover { text-decoration: underline; }
  nav { margin-bottom: 2rem; display: flex; gap: 1rem; }
  .post-list { list-style: none; padding: 0; }
  .post-list li { margin-bottom: 1rem; border-bottom: 1px solid #eee; padding-bottom: 1rem; }
  time { color: #666; font-size: 0.875rem; }
  .htmx-indicator { opacity: 0; transition: opacity 200ms; }
  .htmx-request .htmx-indicator { opacity: 1; }
  #content { min-height: 4rem; }
`;

// Helper: full-page shell wrapping any content area.
function shell(title: string, bodyContent: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${CSS}</style>
  <script src="${HTMX_CDN}" defer></script>
</head>
<body>
  <nav>
    <a href="/" hx-get="/fragments/list" hx-target="#content" hx-push-url="/">Home</a>
    <a href="/admin/">Admin</a>
  </nav>
  <div id="content">
    ${bodyContent}
  </div>
</body>
</html>`;
}

// Helper: load and sort posts for listing.
async function loadPosts() {
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  return records
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    })
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? undefined,
    }));
}

// Fragment: post list — returned by both the full-page / route and HTMX requests.
function listFragment(posts: Array<{ slug: string, updatedAt?: string }>): string {
  if (posts.length === 0) {
    return `<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>`;
  }
  const items = posts
    .map(
      p =>
        `<li>
      <a href="/blog/${p.slug}"
         hx-get="/fragments/post/${p.slug}"
         hx-target="#content"
         hx-push-url="/blog/${p.slug}">
        ${p.slug}
      </a>
      ${p.updatedAt ? `<time>${new Date(p.updatedAt).toLocaleDateString()}</time>` : ''}
    </li>`,
    )
    .join('\n');
  return `<h1>My Blog</h1><ul class="post-list">${items}</ul>`;
}

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

// Fragment: individual post — returned by both /blog/:slug and HTMX requests.
function postFragment(slug: string, post: PostContent): string {
  const { title, date, description, body } = post;
  return `<article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
    <p>
      <a href="/"
         hx-get="/fragments/list"
         hx-target="#content"
         hx-push-url="/">← Back</a>
    </p>
  </article>`;
}

// --- Routes ----------------------------------------------------------------

// Decap JSON:API proxy — WHATWG-native via c.req.raw.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// HTMX fragment: post list (for nav link swap)
app.get('/fragments/list', async c => {
  const posts = await loadPosts();
  return c.html(listFragment(posts));
});

// HTMX fragment: individual post (for in-page swap)
app.get('/fragments/post/:slug', async c => {
  const { slug } = c.req.param();
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    return c.html(postFragment(slug, doc.content as PostContent));
  } catch {
    return c.html('<p>Post not found.</p>', 404);
  }
});

// Full page: blog index (initial load / direct navigation)
app.get('/', async c => {
  const posts = await loadPosts();
  return c.html(shell('My Blog', listFragment(posts)));
});

// Full page: individual post (direct navigation / SSR fallback when JS is off)
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    return c.html(shell(
      (doc.content as PostContent).title ?? slug,
      postFragment(slug, doc.content as PostContent),
    ));
  } catch {
    return c.html(shell('Not Found', '<h1>404</h1><p>Post not found.</p>'), 404);
  }
});

// Static files — /admin/index.html, /admin/bundle.js, /uploads/*, etc.
app.use('/*', serveStatic({ root: './public' }));

const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`HTMX blog running at http://localhost:${info.port}`);
  console.log(`  Blog:  http://localhost:${info.port}/`);
  console.log(`  Admin: http://localhost:${info.port}/admin/`);
});
