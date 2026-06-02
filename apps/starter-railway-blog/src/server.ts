/**
 * Railway.app blog — Hono + LaikaCMS.
 *
 * Key ergonomic win demonstrated here: decapAdminHtml() + minimalBlogConfig()
 * eliminate the separate admin esbuild pipeline entirely. No admin-client.ts,
 * no public/admin/index.html, no bundle.js — the admin shell HTML and Decap
 * backend are loaded from CDN and inlined at server startup.
 *
 * Doc gap surfaced: The decapAdminHtml() helper is not yet featured prominently
 * in the LaikaCMS docs. Most starter examples still use the manual pattern
 * (esbuild + admin-client.ts). For projects that don't need a custom Decap
 * widget, the helper is strictly simpler.
 *
 * Railway-specific patterns:
 *  - CONTENT_DIR env var → set to your volume mount path (e.g. /data/content)
 *    in the Railway dashboard after adding a persistent volume.
 *  - PORT is injected by Railway; default 3000 for local dev.
 *  - nixpacks auto-detects Node.js — no Dockerfile needed.
 *  - mkdirSync(CONTENT_DIR, { recursive: true }) ensures the directory exists
 *    on first deploy when the volume is empty.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { serve } from '@hono/node-server';
import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

const PORT = Number(process.env['PORT'] ?? 3000);

// In Railway production: set CONTENT_DIR to the volume mount path, e.g.
//   /data/content   (if your volume is mounted at /data)
// Locally it falls back to ./content in the project directory.
const CONTENT_DIR = resolve(process.env['CONTENT_DIR'] ?? './content');

// Ensure directory exists — first deploy on Railway has an empty volume.
mkdirSync(CONTENT_DIR, { recursive: true });

const decapConfig = minimalBlogConfig();

const laika = createEmbeddedLaika({
  contentDir: CONTENT_DIR,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

// decapAdminHtml() generates the full admin shell HTML inline — no esbuild,
// no bundle.js, no public/admin/ directory needed.
const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Railway starter',
});

interface PostSummary {
  type: string;
  key: string;
  updatedAt?: string;
}

interface PostContent {
  title?: string;
  date?: string;
  body?: string;
}

const app = new Hono();

// Health check + index
app.get('/', async c => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  const posts = (items as PostSummary[])
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });

  const listHtml = posts.length === 0
    ? `<p style="color:#666">No posts yet — <a href="/admin">open the CMS</a> to write your first post.</p>`
    : `<ul style="list-style:none;padding:0">${
      posts
        .map(post => {
          const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
          const date = post.updatedAt
            ? ` <time style="color:#999;font-size:.85em">${new Date(post.updatedAt).toLocaleDateString()}</time>`
            : '';
          return `<li style="margin:.6rem 0"><a href="/blog/${slug}" style="color:#0070f3">${slug}</a>${date}</li>`;
        })
        .join('')
    }</ul>`;

  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Railway Blog</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px}a{color:#0070f3}</style>
</head><body>
<h1>Railway Blog</h1>
${listHtml}
<p><a href="/admin">Open CMS ↗</a></p>
</body></html>`);
});

app.get('/blog/:slug', async c => {
  const slug = c.req.param('slug');
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}.md`));
    const { title, body } = doc.content as PostContent;
    return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title ?? slug}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px}a{color:#0070f3}</style>
</head><body>
<p><a href="/">← Back</a></p>
<h1>${title ?? slug}</h1>
<article>${body ?? ''}</article>
</body></html>`);
  } catch (err) {
    if (err instanceof NotFoundError) {
      c.status(404);
      return c.html(`<h1>Post not found</h1><p><a href="/">← Back</a></p>`);
    }
    throw err;
  }
});

// Decap admin shell — zero build-step thanks to decapAdminHtml()
app.get('/admin', c => c.html(ADMIN_HTML));

// Decap JSON:API proxy — Hono's c.req.raw is a WHATWG Request, so this is
// the one-liner equivalent of the Express ~20-line bridge.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, info => {
  // eslint-disable-next-line no-console
  console.log(`\nRailway blog running at http://localhost:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`  Blog:    http://localhost:${info.port}/`);
  // eslint-disable-next-line no-console
  console.log(`  Admin:   http://localhost:${info.port}/admin`);
  // eslint-disable-next-line no-console
  console.log(`  Content: ${CONTENT_DIR}`);
});
