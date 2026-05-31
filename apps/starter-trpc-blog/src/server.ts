/**
 * Hono server combining tRPC, LaikaCMS Decap API, and a minimal SSR blog.
 *
 *   /trpc/*       tRPC endpoint (all procedures via @hono/trpc-server)
 *   /api/decap/*  Decap JSON:API — used by the Decap CMS admin
 *   /             Blog homepage (SSR via laika.documents.*)
 *   /blog/:slug   Blog post page (SSR via laika.documents.*)
 *   /admin/       Decap CMS admin UI
 *   /uploads/*    Uploaded media
 *
 * Hono, @hono/trpc-server, and laika.fetch are all WHATWG Fetch API native —
 * no IncomingMessage adapter required, unlike Express/Fastify starters.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { trpcServer } from '@hono/trpc-server';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';
import { appRouter } from './router.js';

const app = new Hono();

// tRPC endpoint — @hono/trpc-server bridges Hono context to tRPC handler.
app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
  }),
);

// Decap JSON:API — laika.fetch accepts a WHATWG Request directly.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Blog homepage.
app.get('/', async c => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  const posts = items
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });

  const list = posts.length === 0
    ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
    : '<ul style="list-style:none;padding:0">' + posts.map(r => {
      const slug = r.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const date = r.updatedAt ? ` · <time>${new Date(r.updatedAt).toLocaleDateString()}</time>` : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
    }).join('\n') + '</ul>';

  return c.html(page('My Blog', `<h1>My Blog</h1>${list}`));
});

// Blog post page.
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const { title, date, description, body } = doc.content as {
      title?: string,
      date?: string,
      description?: string,
      body?: string,
    };

    return c.html(
      page(
        title ?? slug,
        `<article>
  <h1>${title ?? slug}</h1>
  ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
  ${description ? `<p><em>${description}</em></p>` : ''}
  <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
</article>
<p><a href="/">← Back</a></p>`,
      ),
    );
  } catch {
    return c.text('Not found', 404);
  }
});

// Static files: admin/, uploads/, etc.
app.use('/*', serveStatic({ root: './public' }));

const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`tRPC blog running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  tRPC:  http://localhost:${PORT}/trpc/posts`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
});

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:2rem 1rem;line-height:1.6;color:#1a1a1a}
    nav a{margin-right:1rem;color:inherit}
    h1,h2,h3{line-height:1.2}
    time{color:#666;font-size:.9em}
    a{color:#0070f3}
  </style>
</head>
<body>
  <nav><a href="/">Blog</a> <a href="/admin/">Admin</a></nav>
  ${body}
</body>
</html>`;
}
