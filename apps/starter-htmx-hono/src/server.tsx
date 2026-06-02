import { resolve } from 'node:path';

import { serve } from '@hono/node-server';
import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

const PORT = Number(process.env.PORT ?? 3000);

const decapConfig = minimalBlogConfig();
const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS HTMX starter' });

const app = new Hono();

const Layout = (props: { children: unknown, title?: string }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{props.title ?? 'LaikaCMS HTMX starter'}</title>
      {/* HTMX itself — small, no build step. */}
      <script src="https://unpkg.com/htmx.org@2.0.4" />
    </head>
    <body style="font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6;">
      <header style="margin-bottom: 2rem;">
        <a href="/" style="text-decoration: none; color: inherit;">
          <h1 style="margin: 0;">LaikaCMS blog</h1>
        </a>
        <nav style="margin-top: 0.5rem;">
          <a href="/" style="margin-right: 1rem;">Home</a>
          <a href="/admin">Admin</a>
        </nav>
      </header>
      <main>{props.children as never}</main>
    </body>
  </html>
);

async function fetchPosts() {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return items
    .filter(item => item.type === 'published')
    .map(item => {
      const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
        string,
        unknown
      >;
      const slug = (item as { key: string }).key.replace(/^posts\//, '').replace(/\.md$/, '');
      return {
        slug,
        title: (content.title as string) ?? slug,
        date: (content.date as string) ?? null,
      };
    });
}

// Home page. The post list fragment is rendered separately so HTMX can
// re-fetch JUST the list when something changes (e.g. after creating a post).
app.get('/', async c => {
  const posts = await fetchPosts();
  return c.html(
    <Layout>
      <p>
        Edit posts at <a href="/admin">/admin</a>{' '}
        (Decap CMS). This page is rendered server-side. HTMX reloads just the post list when content changes — no client
        framework, no JSON API round-trips from the browser.
      </p>
      <button
        hx-get="/fragments/posts"
        hx-target="#post-list"
        hx-swap="outerHTML"
        style="margin-bottom: 1rem;"
      >
        Refresh posts
      </button>
      <div id="post-list">
        {posts.length === 0
          ? (
            <p>
              <em>No posts yet — add one in the admin UI.</em>
            </p>
          )
          : (
            <ul style="list-style: none; padding: 0;">
              {posts.map(post => (
                <li style="margin-bottom: 1rem;">
                  <a href={`/posts/${post.slug}`}>{post.title}</a>
                  {post.date && (
                    <small style="margin-left: 0.5rem; color: #666;">
                      {new Date(post.date).toLocaleDateString()}
                    </small>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
    </Layout>,
  );
});

// HTMX swap target — returns the same #post-list fragment as the home page.
app.get('/fragments/posts', async c => {
  const posts = await fetchPosts();
  return c.html(
    <div id="post-list">
      {posts.length === 0
        ? (
          <p>
            <em>No posts yet — add one in the admin UI.</em>
          </p>
        )
        : (
          <ul style="list-style: none; padding: 0;">
            {posts.map(post => (
              <li style="margin-bottom: 1rem;">
                <a href={`/posts/${post.slug}`}>{post.title}</a>
                {post.date && (
                  <small style="margin-left: 0.5rem; color: #666;">
                    {new Date(post.date).toLocaleDateString()}
                  </small>
                )}
              </li>
            ))}
          </ul>
        )}
    </div>,
  );
});

app.get('/posts/:slug', async c => {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${c.req.param('slug')}`));
    const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
      string,
      unknown
    >;
    const title = (content.title as string) ?? c.req.param('slug');
    const body = (content.body as string) ?? '';
    const date = (content.date as string) ?? null;
    return c.html(
      <Layout title={`${title} · LaikaCMS HTMX starter`}>
        <article>
          <h2 style="margin-bottom: 0.25rem;">{title}</h2>
          {date && <small style="color: #666;">{new Date(date).toLocaleDateString()}</small>}
          <div style="margin-top: 1.5rem; white-space: pre-wrap;">{body}</div>
        </article>
      </Layout>,
    );
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.html(
        <Layout>
          <p>Post not found.</p>
        </Layout>,
        404,
      );
    }
    throw err;
  }
});

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS HTMX backend listening on http://localhost:${info.port}`);
});
