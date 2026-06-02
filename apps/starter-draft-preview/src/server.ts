import { serve } from '@hono/node-server';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from './laika.ts';

// Any non-empty string works as a preview secret. Set PREVIEW_SECRET in env
// before deploying; the dev default keeps the local workflow frictionless.
const PREVIEW_SECRET = process.env.PREVIEW_SECRET ?? 'preview-secret';

const ADMIN_HTML = decapAdminHtml({
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
        publish_mode: 'editorial_workflow',
        fields: [
          { name: 'title', label: 'Title', widget: 'string' },
          { name: 'date', label: 'Date', widget: 'datetime' },
          { name: 'body', label: 'Body', widget: 'markdown' },
        ],
      },
    ],
  },
  title: 'Admin · Draft Preview Blog',
});

const app = new Hono();

// ── Helpers ───────────────────────────────────────────────────────────────────

function previewBanner(slug: string, status: string): string {
  return `<div style="position:sticky;top:0;background:#f59e0b;color:#000;padding:8px 16px;font-family:sans-serif;font-size:14px;display:flex;gap:12px;align-items:center">
    <strong>Preview mode</strong> — this is a <em>${status}</em> draft and is not publicly visible.
    <a href="/posts/${slug}" style="margin-left:auto;color:#000">View published →</a>
  </div>`;
}

function postHtml(opts: { title: string, date: string, body: string, banner?: string }): string {
  const { title, date, body, banner = '' } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>${title}</title></head>
<body style="margin:0;font-family:sans-serif">
  ${banner}
  <div style="max-width:720px;margin:0 auto;padding:24px">
    <a href="/">← Back</a>
    <h1>${title}</h1>
    <p><time>${new Date(date).toLocaleDateString()}</time></p>
    <div>${body}</div>
  </div>
</body>
</html>`;
}

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

  type Summary = { key: string, type: string, content?: Record<string, unknown> };

  const posts = await Promise.all(
    (items as Summary[])
      .filter(r => r.type === 'published-summary')
      .map(async r => {
        const slug = r.key.replace(/^posts\//, '').replace(/\.md$/, '');
        try {
          const doc = await runTask(laika.documents.getDocument(r.key));
          const c = doc.content as Record<string, unknown>;
          return { slug, title: String(c.title ?? slug), date: String(c.date ?? '') };
        } catch {
          return null;
        }
      }),
  );

  const valid = posts.filter(p => p !== null).sort((a, b) => b.date.localeCompare(a.date));

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Draft Preview Blog</title></head>
<body style="font-family:sans-serif;max-width:720px;margin:0 auto;padding:24px">
  <h1>Draft Preview Blog</h1>
  <p>
    <a href="/admin">CMS Admin</a> ·
    <a href="/api/drafts">Draft list (needs token)</a>
  </p>
  <hr />
  ${
    valid.length === 0
      ? '<p>No published posts yet. <a href="/admin">Write one.</a></p>'
      : `<ul>${
        valid
          .map(
            p =>
              `<li>
              <a href="/posts/${p.slug}">${p.title}</a>
              <time style="color:#666;margin-left:8px">${new Date(p.date).toLocaleDateString()}</time>
            </li>`,
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
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}.md`));
    const content = doc.content as Record<string, unknown>;
    return c.html(
      postHtml({
        title: String(content.title ?? slug),
        date: String(content.date ?? ''),
        body: String(content.body ?? ''),
      }),
    );
  } catch (err) {
    if (err instanceof NotFoundError) return c.notFound();
    throw err;
  }
});

// ── Draft preview ─────────────────────────────────────────────────────────────
// Access with ?token=<PREVIEW_SECRET> — keep the token out of URLs in prod by
// using a short-lived signed token or a session cookie instead.

app.get('/preview/:slug', async c => {
  const token = c.req.query('token');
  if (token !== PREVIEW_SECRET) {
    return c.json({ error: 'Missing or invalid preview token' }, 403);
  }

  const { slug } = c.req.param();
  try {
    // getUnpublished searches ALL statuses (draft, pending_review, …) for the key.
    const doc = await runTask(laika.documents.getUnpublished(`posts/${slug}.md`));
    const content = doc.content as Record<string, unknown>;
    return c.html(
      postHtml({
        title: String(content.title ?? slug),
        date: String(content.date ?? ''),
        body: String(content.body ?? ''),
        banner: previewBanner(slug, doc.status),
      }),
    );
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.html(
        `<h1>No draft found</h1><p>There is no unpublished version of <code>${slug}</code>.</p>`,
        404,
      );
    }
    throw err;
  }
});

// List all drafts — useful for editorial dashboards. Token-protected.
app.get('/api/drafts', async c => {
  const token = c.req.query('token');
  if (token !== PREVIEW_SECRET) {
    return c.json({ error: 'Missing or invalid preview token' }, 403);
  }

  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      folder: 'posts',
      depth: 1,
      pagination: { page: 1, perPage: 100 },
      type: 'unpublished',
    }),
  );

  type UnpublishedSummary = { key: string, type: string, status: string };

  const drafts = (items as UnpublishedSummary[])
    .filter(r => r.type === 'unpublished-summary')
    .map(r => ({
      key: r.key,
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      status: r.status,
    }))
    .map(d => ({
      ...d,
      previewUrl: `/preview/${d.slug}?token=${PREVIEW_SECRET}`,
    }));

  return c.json({ data: drafts, meta: { total: drafts.length } });
});

// ── Admin + CMS API ───────────────────────────────────────────────────────────

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Listening on http://localhost:${port}`);
  console.log(`Preview secret: ${PREVIEW_SECRET}`);
  console.log(`Draft list:     http://localhost:${port}/api/drafts?token=${PREVIEW_SECRET}`);
});
