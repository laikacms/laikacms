/** @jsxImportSource preact */
/**
 * Preact SSR blog server — no Vite, no React runtime.
 *
 * Key differences from React:
 *   - preact-render-to-string renderToString instead of react-dom/server
 *   - jsxImportSource=preact in tsconfig + tsx handles TSX compilation on the fly
 *   - ~3kB runtime vs React's ~40kB — shows Preact is a drop-in React replacement
 *
 * The client receives only static HTML — no Preact JS is shipped to the browser.
 * For hydration you'd add a client entry with preact/compat or preact islands.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { renderToString } from 'preact-render-to-string';

import { laika } from './laika.js';
import { BlogListPage, BlogPostPage, NotFoundPage, type PostContent } from './pages.js';

const app = new Hono();

// Decap JSON:API — forward all /api/decap/* to the embedded laika handler.
// c.req.raw is the WHATWG Request that laika.fetch expects — no bridging needed.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Blog index — list published posts.
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
    })
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? undefined,
    }));

  const html = renderToString(<BlogListPage posts={posts} />);
  return c.html(`<!doctype html>${html}`);
});

// Individual blog post.
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();

  let post: PostContent;
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    post = doc.content as PostContent;
  } catch {
    return c.html(`<!doctype html>${renderToString(<NotFoundPage />)}`, 404);
  }

  const html = renderToString(<BlogPostPage slug={slug} post={post} />);
  return c.html(`<!doctype html>${html}`);
});

// Static files — serves /admin/index.html, /admin/bundle.js, /uploads/*, etc.
app.use('/*', serveStatic({ root: './public' }));

const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Preact SSR blog running at http://localhost:${info.port}`);
  console.log(`  Blog:  http://localhost:${info.port}/`);
  console.log(`  Admin: http://localhost:${info.port}/admin/`);
});
