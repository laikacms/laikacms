import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { serve as inngestServe } from 'inngest/hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { resolve } from 'node:path';

import { inngest, onPostDeleted, onPostSaved, type PostDeletedData, type PostSavedData } from './inngest.ts';

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
          { name: 'body', label: 'Body', widget: 'markdown' },
        ],
      },
    ],
  },
});

const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · Inngest Blog' });

// ── LaikaCMS doesn't have a native hook system, so we intercept at the HTTP
// layer: pass the request to laika.fetch, then check if the response was a
// successful document write and fire Inngest events accordingly.
async function laikaWithEvents(request: Request): Promise<Response> {
  const response = await laika.fetch(request);

  if (response.ok) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const isDocumentPath = url.pathname.includes('/documents/');

    if (isDocumentPath && (method === 'POST' || method === 'PUT')) {
      const key = url.pathname.split('/documents/')[1] ?? '';
      void inngest.send({
        name: 'cms/post.saved',
        data: {
          key,
          method: method as PostSavedData['method'],
          statusCode: response.status,
        } satisfies PostSavedData,
      });
    }

    if (isDocumentPath && method === 'DELETE') {
      const key = url.pathname.split('/documents/')[1] ?? '';
      void inngest.send({
        name: 'cms/post.deleted',
        data: { key } satisfies PostDeletedData,
      });
    }
  }

  return response;
}

const app = new Hono();

app.get('/admin', c => c.html(ADMIN_HTML));

// Inngest serve handler — Inngest cloud calls this to invoke functions.
// Run `npx inngest-cli@latest dev` locally to see function runs.
app.all(
  '/api/inngest',
  inngestServe({ client: inngest, functions: [onPostSaved, onPostDeleted] }),
);

// LaikaCMS API with event interception
app.all('/api/decap/*', c => laikaWithEvents(c.req.raw));

// ── Public blog ───────────────────────────────────────────────────────────────

app.get('/', async c => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      folder: 'posts',
      depth: 1,
      pagination: { page: 1, perPage: 100 },
      type: 'published',
    }),
  );

  type Summary = { key: string, type: string, updatedAt?: string };
  const posts = (items as Summary[])
    .filter(r => r.type === 'published-summary')
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? null,
    }));

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Inngest Blog</title></head>
<body>
  <h1>Inngest Blog</h1>
  <p><a href="/admin">CMS Admin</a> · <a href="/api/inngest">Inngest status</a></p>
  <hr />
  ${
    posts.length === 0
      ? '<p>No posts yet. <a href="/admin">Write one.</a></p>'
      : `<ul>${
        posts
          .map(
            p =>
              `<li><a href="/posts/${p.slug}">${p.slug}</a>${
                p.updatedAt
                  ? ` · <time>${new Date(p.updatedAt).toLocaleDateString()}</time>`
                  : ''
              }</li>`,
          )
          .join('')
      }</ul>`
  }
</body>
</html>`);
});

app.get('/posts/:slug', async c => {
  const { slug } = c.req.param();
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const content = doc.content as { title?: string, body?: string };
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>${content.title ?? slug}</title></head>
<body>
  <a href="/">← Back</a>
  <h1>${content.title ?? slug}</h1>
  <div>${content.body ?? ''}</div>
</body>
</html>`);
  } catch (err) {
    if (err instanceof NotFoundError) return c.notFound();
    throw err;
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Listening on http://localhost:${port}`);
  console.log('Run `npx inngest-cli@latest dev` to see background job runs');
});
