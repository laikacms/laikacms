/** @jsxImportSource hono/jsx */
/**
 * Hono JSX blog — Hono's built-in JSX renderer, zero extra dependencies.
 *
 * hono/jsx is Hono's own JSX runtime. Unlike React/Preact:
 *   - Designed for edge and server rendering; no virtual DOM, no hooks on server
 *   - jsxImportSource: "hono/jsx" in tsconfig wires it up; tsx handles compilation
 *   - c.render(<Component />) handles Content-Type and DOCTYPE automatically
 *   - hono/jsx/dom provides a tiny client-side runtime if you need hydration
 *
 * This starter is pure server-side — no client JS shipped except the admin bundle.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

const app = new Hono();

// --- Components -------------------------------------------------------------

const CSS = `
  body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  a { color: #0070f3; }
  nav { margin-bottom: 2rem; }
  .post-list { list-style: none; padding: 0; }
  .post-list li { margin-bottom: 1rem; }
  time { color: #666; font-size: 0.875rem; margin-left: 0.5rem; }
`;

function Layout({ title, children }: { title: string, children?: unknown }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {/* hono/jsx passes style content as children — no dangerouslySetInnerHTML */}
        <style>{CSS}</style>
      </head>
      <body>
        <nav>
          <a href="/">Home</a> · <a href="/admin/">Admin</a>
        </nav>
        {children}
      </body>
    </html>
  );
}

type Post = { slug: string, updatedAt?: string };

function BlogListPage({ posts }: { posts: Post[] }) {
  return (
    <Layout title="My Blog">
      <h1>My Blog</h1>
      {posts.length === 0
        ? (
          <p>
            No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.
          </p>
        )
        : (
          <ul class="post-list">
            {posts.map(p => (
              <li>
                <a href={`/blog/${p.slug}`}>{p.slug}</a>
                {p.updatedAt && <time>{new Date(p.updatedAt).toLocaleDateString()}</time>}
              </li>
            ))}
          </ul>
        )}
    </Layout>
  );
}

type PostContent = { title?: string, date?: string, description?: string, body?: string };

function BlogPostPage({ slug, post }: { slug: string, post: PostContent }) {
  const { title, date, description, body } = post;
  return (
    <Layout title={title ?? slug}>
      <article>
        <h1>{title ?? slug}</h1>
        {date && <time>{new Date(date).toLocaleDateString()}</time>}
        {description && (
          <p>
            <em>{description}</em>
          </p>
        )}
        <pre style="white-space:pre-wrap;font-family:inherit">{body ?? ''}</pre>
      </article>
      <p>
        <a href="/">← Back</a>
      </p>
    </Layout>
  );
}

function NotFoundPage() {
  return (
    <Layout title="Not Found">
      <h1>404</h1>
      <p>Page not found.</p>
    </Layout>
  );
}

// --- Routes -----------------------------------------------------------------

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
    })
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? undefined,
    }));

  // c.render wraps the JSX in <!doctype html> and sets Content-Type: text/html
  return c.render(<BlogListPage posts={posts} />);
});

app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();

  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    return c.render(<BlogPostPage slug={slug} post={doc.content as PostContent} />);
  } catch {
    // c.render() takes only 1 argument — set status via c.status() first
    c.status(404);
    return c.render(<NotFoundPage />);
  }
});

app.use('/*', serveStatic({ root: './public' }));

const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Hono JSX blog running at http://localhost:${info.port}`);
  console.log(`  Blog:  http://localhost:${info.port}/`);
  console.log(`  Admin: http://localhost:${info.port}/admin/`);
});
