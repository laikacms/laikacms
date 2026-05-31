/**
 * Hono server wiring three concerns together:
 *
 *   /graphql          GraphQL Yoga endpoint — query blog content
 *   /api/decap/*      Decap JSON:API — used by the CMS admin UI
 *   /                 Simple HTML blog reading content via GraphQL resolvers directly
 *   /admin/           Decap CMS admin UI (static HTML + bundled client)
 *   /uploads/*        Media uploaded through the CMS admin
 *
 * Both Hono and GraphQL Yoga speak the WHATWG Fetch Request/Response API natively.
 * laika.fetch also expects a WHATWG Request. This means NO IncomingMessage adapter
 * is needed — contrast with Express or plain node:http starters that require a
 * toLaikaRequest bridge.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createYoga } from 'graphql-yoga';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';
import { schema } from './schema.js';

const app = new Hono();

// GraphQL endpoint — GraphQL Yoga returns a WHATWG Response from its handler.
const yoga = createYoga({ schema, graphqlEndpoint: '/graphql' });
app.all('/graphql', c => yoga.handle(c.req.raw, c));

// Decap JSON:API — laika.fetch accepts a WHATWG Request directly.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Blog homepage — SSR using laika.documents.* directly (same resolvers as GraphQL).
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

  const items_html = posts.length === 0
    ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
    : posts.map(r => {
      const slug = r.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const date = r.updatedAt ? ` · <time>${new Date(r.updatedAt).toLocaleDateString()}</time>` : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
    }).join('\n');

  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title>${styles}</head>
<body>
  <nav><a href="/">Blog</a> <a href="/graphql">GraphQL</a> <a href="/admin/">Admin</a></nav>
  <h1>My Blog</h1>
  ${posts.length === 0 ? items_html : `<ul style="list-style:none;padding:0">${items_html}</ul>`}
</body>
</html>`);
});

// Blog post page — SSR using laika.documents.getDocument.
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

    return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title>${styles}</head>
<body>
  <nav><a href="/">Blog</a> <a href="/graphql">GraphQL</a> <a href="/admin/">Admin</a></nav>
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`);
  } catch {
    return c.text('Not found', 404);
  }
});

// Static files: /admin/index.html, /admin/bundle.js, /uploads/*, etc.
app.use('/*', serveStatic({ root: './public' }));

const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`GraphQL blog running at http://localhost:${PORT}`);
  console.log(`  Blog:    http://localhost:${PORT}/`);
  console.log(`  GraphQL: http://localhost:${PORT}/graphql`);
  console.log(`  Admin:   http://localhost:${PORT}/admin/`);
});

const styles = `<style>
  *,*::before,*::after{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:2rem 1rem;line-height:1.6;color:#1a1a1a}
  nav a{margin-right:1rem;color:inherit}
  h1,h2,h3{line-height:1.2}
  time{color:#666;font-size:.9em}
  a{color:#0070f3}
</style>`;
