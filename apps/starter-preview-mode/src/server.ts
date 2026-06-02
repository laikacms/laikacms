/**
 * starter-preview-mode — draft preview with laika.documents.getUnpublished()
 *
 * Shows two document-access paths:
 *
 *   Public    laika.documents.getDocument(key)       — published only
 *   Preview   laika.documents.getUnpublished(key)    — draft / pending_review / etc.
 *
 * Preview URLs look like:
 *   /preview/<slug>?token=<PREVIEW_TOKEN>
 *
 * Doc gap this fixes: every other starter only shows getDocument (published).
 * getUnpublished() — and the 'unpublished' type in listRecordSummaries — were
 * never demonstrated.
 *
 * The draft list at /drafts is also gated by the preview token so editors can
 * see what's waiting to be published.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';

// ── Config ────────────────────────────────────────────────────────────────────

const PREVIEW_TOKEN = process.env.PREVIEW_TOKEN ?? 'dev-preview-token';
const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(__dirname, '../content');
const decapConfig = minimalBlogConfig();

const laika = createEmbeddedLaika({
  contentDir,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const adminHtml = decapAdminHtml({ decapConfig, title: 'Admin · Preview Mode' });

// ── Helpers ───────────────────────────────────────────────────────────────────

function verifyPreviewToken(token: string | undefined): boolean {
  return token === PREVIEW_TOKEN;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const html = String.raw;

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

app.all('/api/decap/*', c => laika.fetch(c.req.raw));
app.get('/admin', c => c.html(adminHtml));

// Blog index — published posts only.
app.get('/', async c => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );
  type Summary = { type: string, key: string, updatedAt?: string };
  const posts = (items as Summary[])
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => (b.updatedAt ?? b.key).localeCompare(a.updatedAt ?? a.key));

  return c.html(html`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title>
<style>body{max-width:48rem;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif}</style>
</head>
<body>
<nav>
  <a href="/" style="font-weight:bold">My Blog</a> ·
  <a href="/admin">CMS</a> ·
  <a href="/drafts?token=${encodeURIComponent(PREVIEW_TOKEN)}">Drafts ↗</a>
</nav>
<h1>My Blog</h1>
${
    posts.length === 0
      ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">
${
        posts.map(p => {
          const slug = p.key.replace(/^posts\//, '').replace(/\.md$/, '');
          const date = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '';
          return `<li>
  <a href="/blog/${slug}">${slug}</a>
  ${date ? `<time style="color:#666">${date}</time>` : ''}
  <a href="/preview/${slug}?token=${
            encodeURIComponent(PREVIEW_TOKEN)
          }" style="font-size:.8rem;color:#999;margin-left:.5rem">preview</a>
</li>`;
        }).join('\n')
      }
</ul>`
  }
</body></html>`);
});

// Drafts list — unpublished posts (preview token required).
app.get('/drafts', async c => {
  if (!verifyPreviewToken(c.req.query('token'))) {
    return c.html('<h1>403 — Forbidden</h1><p>Missing or invalid preview token.</p>', 403);
  }

  // list all unpublished (draft + pending_review + pending_publish + archived)
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'unpublished',
    }),
  );
  type Summary = { type: string, key: string, updatedAt?: string };
  const drafts = (items as Summary[])
    .filter(r => r.type === 'unpublished-summary')
    .sort((a, b) => (b.updatedAt ?? b.key).localeCompare(a.updatedAt ?? a.key));

  return c.html(html`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Drafts · My Blog</title>
<style>body{max-width:48rem;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif}</style>
</head>
<body>
<nav><a href="/">← Back to blog</a> · <a href="/admin">CMS</a></nav>
<h1>Drafts</h1>
${
    drafts.length === 0
      ? '<p>No drafts. Create one in the <a href="/admin">CMS</a>.</p>'
      : `<ul style="list-style:none;padding:0">
${
        drafts.map(p => {
          const slug = p.key.replace(/^posts\//, '').replace(/\.md$/, '');
          const date = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '';
          return `<li>
  <a href="/preview/${slug}?token=${encodeURIComponent(PREVIEW_TOKEN)}">${slug}</a>
  ${date ? `<time style="color:#999">${date}</time>` : ''}
  <span style="font-size:.8rem;color:#999;background:#f3f4f6;padding:.1rem .4rem;border-radius:.25rem;margin-left:.5rem">draft</span>
</li>`;
        }).join('\n')
      }
</ul>`
  }
</body></html>`);
});

// Preview — renders an unpublished (draft) post.
// Uses laika.documents.getUnpublished() which is separate from getDocument().
app.get('/preview/:slug', async c => {
  const slug = c.req.param('slug');
  if (!verifyPreviewToken(c.req.query('token'))) {
    return c.html('<h1>403 — Forbidden</h1><p>Missing or invalid preview token.</p>', 403);
  }

  try {
    // getUnpublished returns draft/pending_review/archived/trash docs.
    // getDocument (used in /blog/:slug) returns only published docs.
    const doc = await runTask(laika.documents.getUnpublished(`posts/${slug}`));
    type Post = { title?: string, date?: string, description?: string, body?: string };
    const { title, date, description, body } = (doc.content ?? {}) as Post;

    return c.html(html`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>[Draft] ${title ?? slug}</title>
<style>
  body{max-width:48rem;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif}
  .banner{background:#fef9c3;border:1px solid #fde047;border-radius:.375rem;padding:.75rem 1rem;margin-bottom:2rem;font-size:.875rem}
</style>
</head>
<body>
<nav><a href="/">← Blog</a> · <a href="/drafts?token=${
      encodeURIComponent(c.req.query('token') ?? '')
    }">← Drafts</a></nav>
<div class="banner">
  ⚠️ <strong>Preview mode</strong> — this post is a draft and not publicly visible.
  Status: <code>${doc.status}</code>
</div>
<article>
<h1>${title ?? slug}</h1>
${date ? `<time style="color:#666">${new Date(date).toLocaleDateString()}</time>` : ''}
${description ? `<p><em>${esc(description)}</em></p>` : ''}
<pre style="white-space:pre-wrap;font-family:inherit">${esc(body ?? '')}</pre>
<p><a href="/">← Back to blog</a></p>
</article>
</body></html>`);
  } catch {
    return c.html(
      '<h1>404 – Draft not found</h1><p>This post may have been published or deleted.</p><p><a href="/drafts?token='
        + encodeURIComponent(c.req.query('token') ?? '') + '">← Drafts</a></p>',
      404,
    );
  }
});

// Public post — published only.
app.get('/blog/:slug', async c => {
  const slug = c.req.param('slug');
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    type Post = { title?: string, date?: string, description?: string, body?: string };
    const { title, date, description, body } = (doc.content ?? {}) as Post;

    return c.html(html`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title>
<style>body{max-width:48rem;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif}</style>
</head>
<body>
<nav><a href="/" style="font-weight:bold">My Blog</a> · <a href="/admin">CMS</a></nav>
<article>
<h1>${title ?? slug}</h1>
${date ? `<time style="color:#666">${new Date(date).toLocaleDateString()}</time>` : ''}
${description ? `<p><em>${esc(description)}</em></p>` : ''}
<pre style="white-space:pre-wrap;font-family:inherit">${esc(body ?? '')}</pre>
<p><a href="/">← Back</a></p>
</article>
</body></html>`);
  } catch {
    return c.html('<h1>404 – Not found</h1><p><a href="/">← Home</a></p>', 404);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Running on http://localhost:${PORT}`);
  console.log(`Admin:         http://localhost:${PORT}/admin`);
  console.log(`Drafts:        http://localhost:${PORT}/drafts?token=${PREVIEW_TOKEN}`);
  console.log(`Preview token: ${PREVIEW_TOKEN}`);
});
