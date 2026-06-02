import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { renderToReadableStream } from 'react-dom/server';

import { HomePage } from './components/HomePage.js';
import { PostPage } from './components/PostPage.js';
import { laika } from './laika.js';

const app = new Hono();

// Decap JSON:API — Hono is WHATWG-native so c.req.raw is already a Web API
// Request. No adapter needed: pass it directly to laika.fetch.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Static files (uploads, admin bundle)
app.use('/uploads/*', serveStatic({ root: './public' }));
app.use('/admin/*', serveStatic({ root: './public' }));

// Blog index — list published posts via laika.documents (no extra HTTP round-trip).
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
    })
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      date: r.updatedAt,
    }));

  // React 19: renderToReadableStream returns a ReadableStream<Uint8Array>.
  // Hono's Response constructor accepts it directly — no buffering needed.
  const stream = await renderToReadableStream(<HomePage posts={posts} />);

  return new Response(stream, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});

// Individual blog post
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();

  let body: string;
  try {
    const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    body = (post.content as { body?: string }).body ?? '';
  } catch {
    return c.notFound();
  }

  const stream = await renderToReadableStream(<PostPage slug={slug} body={body} />);
  return new Response(stream, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});

const port = Number(process.env['PORT'] ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running at http://localhost:${port}`);
});
