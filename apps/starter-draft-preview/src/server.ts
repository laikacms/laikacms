import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { decapConfig, laika } from './laika.js';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';

/**
 * Secret token for preview mode.
 *
 * Visiting /preview?token=<this-value> sets a session cookie that grants
 * visibility into unpublished (draft) posts. In production, set via an
 * environment variable and do NOT commit the value.
 */
const PREVIEW_SECRET = process.env.PREVIEW_SECRET ?? 'dev-preview-secret';
const PREVIEW_COOKIE = 'laika_preview';

const app = new Hono();

// ── Decap JSON:API ────────────────────────────────────────────────────────────
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// ── Preview mode toggle ───────────────────────────────────────────────────────
//
// GET /preview?token=<PREVIEW_SECRET>
//   Validates the token, sets a session cookie, and redirects to the blog.
//   Editors share this URL to let stakeholders preview draft content.
//
// GET /preview/exit
//   Clears the preview cookie and redirects to the published blog.
app.get('/preview', c => {
  const token = c.req.query('token');
  if (token !== PREVIEW_SECRET) {
    return c.text('Invalid preview token.', 403);
  }
  setCookie(c, PREVIEW_COOKIE, 'true', {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    // No maxAge → session cookie; cleared when the browser closes.
  });
  return c.redirect('/', 302);
});

app.get('/preview/exit', c => {
  deleteCookie(c, PREVIEW_COOKIE, { path: '/' });
  return c.redirect('/', 302);
});

/** True when the request carries a valid preview cookie. */
function isPreview(c: Context): boolean {
  return getCookie(c, PREVIEW_COOKIE) === 'true';
}

// ── Blog index ────────────────────────────────────────────────────────────────
app.get('/', async c => {
  const preview = isPreview(c);

  // Published posts — always visible.
  const { items: publishedRecords } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  // Draft posts — only shown in preview mode.
  // type: 'unpublished' returns all statuses (draft, pending_review, etc.)
  const draftRecords = preview
    ? (
        await collectStream(
          laika.documents.listRecordSummaries({
            pagination: { page: 1, perPage: 100 },
            folder: 'posts',
            depth: 1,
            type: 'unpublished',
          }),
        )
      ).items
    : [];

  const published = publishedRecords
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .map(r => {
      const slug = r.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const date = r.updatedAt
        ? ` · <time>${new Date(r.updatedAt).toLocaleDateString()}</time>`
        : '';
      return `<li><a href="/blog/${slug}">${slug}</a>${date}</li>`;
    });

  const drafts = draftRecords
    .filter(r => r.type === 'unpublished-summary')
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .map(r => {
      const slug = r.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const badge = `<span style="background:#e8a000;color:#fff;border-radius:3px;padding:1px 6px;font-size:.75rem;margin-left:.5rem">DRAFT</span>`;
      return `<li><a href="/blog/${slug}?draft=1">${slug}</a>${badge}</li>`;
    });

  const previewBanner = preview
    ? `<div style="background:#1e3a5f;color:#fff;padding:.5rem 1rem;font-size:.875rem">
        Preview mode active — drafts are visible.
        <a href="/preview/exit" style="color:#7dd3fc;margin-left:1rem">Exit preview →</a>
      </div>`
    : '';

  const body = published.length === 0 && drafts.length === 0
    ? `<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>`
    : `<ul>${[...published, ...drafts].join('')}</ul>`;

  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Draft Preview Blog</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 0 auto; }
    main { padding: 2rem 1rem; }
    ul { list-style: none; padding: 0; }
    li { margin: .5rem 0; }
  </style>
</head>
<body>
  ${previewBanner}
  <main>
    <h1>Draft Preview Blog</h1>
    ${body}
    <p style="margin-top:2rem"><a href="/admin/">Admin →</a></p>
  </main>
</body>
</html>`);
});

// ── Single post ───────────────────────────────────────────────────────────────
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();
  const wantDraft = c.req.query('draft') === '1';
  const preview = isPreview(c);

  // Gate: drafts require preview mode.
  if (wantDraft && !preview) {
    return c.text('Preview mode is not active. Add ?token=<PREVIEW_SECRET> to enable it.', 403);
  }

  let title: string | undefined;
  let date: string | undefined;
  let body: string | undefined;
  let isDraft = false;
  let draftStatus: string | undefined;

  if (wantDraft) {
    // Load draft content from the unpublished store.
    //
    // getUnpublished() returns the raw Unpublished entity including its
    // status ('draft', 'pending_review', etc.) and content.
    let unpublished;
    try {
      unpublished = await runTask(laika.documents.getUnpublished(`posts/${slug}`));
    } catch (err) {
      if (err instanceof NotFoundError) return c.notFound();
      throw err;
    }
    isDraft = true;
    draftStatus = unpublished.status;
    const c2 = unpublished.content as { title?: string, date?: string, body?: string };
    title = c2.title;
    date = c2.date;
    body = c2.body;
  } else {
    // Load published document normally.
    let doc;
    try {
      doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    } catch (err) {
      if (err instanceof NotFoundError) return c.notFound();
      throw err;
    }
    const c2 = doc.content as { title?: string, date?: string, body?: string };
    title = c2.title;
    date = c2.date;
    body = c2.body;
  }

  const draftBadge = isDraft
    ? `<span style="background:#e8a000;color:#fff;border-radius:3px;padding:2px 8px;font-size:.8rem;margin-left:.75rem">
        ${draftStatus?.toUpperCase() ?? 'DRAFT'}
      </span>`
    : '';

  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title ?? slug}${isDraft ? ' (Draft)' : ''}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  </style>
</head>
<body>
  <article>
    <h1>${title ?? slug}${draftBadge}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`);
});

// ── Admin ─────────────────────────────────────────────────────────────────────
app.get('/admin', c => c.html(decapAdminHtml({ decapConfig })));
app.get('/admin/', c => c.html(decapAdminHtml({ decapConfig })));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Draft preview blog at http://localhost:${info.port}`);
  console.log(`  Blog:    http://localhost:${info.port}/`);
  console.log(`  Admin:   http://localhost:${info.port}/admin/`);
  console.log(`  Preview: http://localhost:${info.port}/preview?token=${PREVIEW_SECRET}`);
});
