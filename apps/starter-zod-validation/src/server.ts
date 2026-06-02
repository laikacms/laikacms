import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { resolve } from 'node:path';

import { PostSchema, PostSummarySchema } from './schemas.ts';

const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_root: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: [
      {
        name: 'posts',
        label: 'Posts',
        folder: 'posts',
        create: true,
        slug: '{{slug}}',
        extension: 'md',
        fields: [
          { name: 'title', label: 'Title', widget: 'string' },
          { name: 'date', label: 'Date', widget: 'datetime' },
          { name: 'draft', label: 'Draft', widget: 'boolean', default: false },
          { name: 'tags', label: 'Tags', widget: 'list', allow_add: true },
          { name: 'body', label: 'Body', widget: 'markdown' },
        ],
      },
    ],
  },
});

const ADMIN_HTML = decapAdminHtml({
  decapConfig: minimalBlogConfig(),
  title: 'Admin · Zod Blog',
});

const app = new Hono();

// ── Typed content JSON API ────────────────────────────────────────────────────

// Returns validated PostSummary[] — consumers get a stable shape they can trust.
app.get('/api/posts', async c => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      folder: 'posts',
      depth: 1,
      pagination: { page: 1, perPage: 100 },
      type: 'published',
    }),
  );

  type RawSummary = { key: string, type: string, content?: Record<string, unknown> };

  const posts = await Promise.all(
    (items as RawSummary[])
      .filter(r => r.type === 'published-summary')
      .map(async r => {
        const slug = r.key.replace(/^posts\//, '').replace(/\.md$/, '');
        try {
          const doc = await runTask(laika.documents.getDocument(r.key));
          const parsed = PostSummarySchema.safeParse({ slug, ...doc.content });
          if (!parsed.success) {
            console.warn(`[zod] malformed post ${r.key}:`, parsed.error.issues);
            return null;
          }
          return parsed.data;
        } catch {
          return null;
        }
      }),
  );

  const valid = posts.filter(p => p !== null);
  return c.json({ data: valid, meta: { total: valid.length } });
});

// Returns a single validated Post — 422 if the content doesn't match the schema.
app.get('/api/posts/:slug', async c => {
  const { slug } = c.req.param();
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));

    // doc.content is Record<string, unknown> — Zod is the natural fit here.
    const result = PostSchema.safeParse(doc.content);
    if (!result.success) {
      return c.json(
        {
          error: 'Content validation failed',
          issues: result.error.issues,
        },
        422,
      );
    }

    return c.json({ data: { slug, ...result.data } });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Post not found' }, 404);
    throw err;
  }
});

// ── Admin + CMS API ───────────────────────────────────────────────────────────

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// ── HTML blog (using the validated JSON API as its data layer) ────────────────

app.get('/', async c => {
  const res = await app.fetch(new Request(`http://localhost/api/posts`));
  const { data: posts } = (await res.json()) as { data: Array<{ slug: string, title: string, date: string }> };

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Zod Blog</title></head>
<body>
  <h1>Zod Blog</h1>
  <p><a href="/admin">CMS Admin</a> · <a href="/api/posts">JSON API</a></p>
  <hr />
  ${
    posts.length === 0
      ? '<p>No posts yet. <a href="/admin">Write one.</a></p>'
      : `<ul>${
        posts
          .map(
            p =>
              `<li><a href="/posts/${p.slug}">${p.title}</a> · <time>${
                new Date(p.date).toLocaleDateString()
              }</time></li>`,
          )
          .join('')
      }</ul>`
  }
</body>
</html>`);
});

app.get('/posts/:slug', async c => {
  const { slug } = c.req.param();
  const res = await app.fetch(new Request(`http://localhost/api/posts/${slug}`));

  if (res.status === 404) return c.notFound();
  if (res.status === 422) {
    const body = (await res.json()) as { issues: unknown[] };
    return c.html(`<h1>Malformed content</h1><pre>${JSON.stringify(body.issues, null, 2)}</pre>`, 422);
  }

  const { data: post } = (await res.json()) as {
    data: { slug: string, title: string, body: string, date: string },
  };
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>${post.title}</title></head>
<body>
  <a href="/">← Back</a>
  <h1>${post.title}</h1>
  <p><time>${new Date(post.date).toLocaleDateString()}</time></p>
  <div>${post.body}</div>
</body>
</html>`);
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Listening on http://localhost:${port}`);
});
