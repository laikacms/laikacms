/**
 * AWS App Runner blog — Hono + LaikaCMS.
 *
 * App Runner runs a Docker container (or source code directly) and auto-scales
 * to zero. It injects $PORT (default 8080). Content lives in CONTENT_DIR.
 *
 * Storage note: App Runner has NO persistent volumes. Content written to the
 * local filesystem is lost when the instance recycles. For production use
 * one of the LaikaCMS cloud storage adapters:
 *   - @laikacms/s3           — AWS S3 (natural fit for App Runner / Lambda)
 *   - @laikacms/github       — GitHub repository-backed content
 *   - @laikacms/cloudflare-r2 — Cloudflare R2
 *
 * For local development and demos, the filesystem adapter is fine.
 *
 * Doc gap surfaced: the "storage is ephemeral in managed container runtimes"
 * warning is absent from most LaikaCMS starter READMEs. Users deploying to
 * App Runner, Cloud Run, or Fly.io (without a volume) will silently lose
 * content on redeploy unless they notice this.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { serve } from '@hono/node-server';
import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

// App Runner injects PORT (default 8080). 3000 for local dev.
const PORT = Number(process.env['PORT'] ?? 3000);

// Point CONTENT_DIR at an EFS mount (via App Runner VPC Connector) or an S3
// path (via the @laikacms/s3 adapter) for persistent content in production.
const CONTENT_DIR = resolve(process.env['CONTENT_DIR'] ?? './content');

mkdirSync(CONTENT_DIR, { recursive: true });

const decapConfig = minimalBlogConfig();

const laika = createEmbeddedLaika({
  contentDir: CONTENT_DIR,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS App Runner starter',
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

// Health check — App Runner polls this path to determine service health.
app.get('/health', c => c.json({ status: 'ok' }));

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
    ? `<p style="color:#666">No posts — <a href="/admin">open the CMS</a> to create one.</p>`
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
<title>App Runner Blog</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px}a{color:#0070f3}</style>
</head><body>
<h1>App Runner Blog</h1>
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

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, info => {
  // eslint-disable-next-line no-console
  console.log(`\nApp Runner blog running at http://localhost:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`  Blog:    http://localhost:${info.port}/`);
  // eslint-disable-next-line no-console
  console.log(`  Admin:   http://localhost:${info.port}/admin`);
  // eslint-disable-next-line no-console
  console.log(`  Health:  http://localhost:${info.port}/health`);
  // eslint-disable-next-line no-console
  console.log(`  Content: ${CONTENT_DIR}`);
});
