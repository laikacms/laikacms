import { serve } from '@hono/node-server';
import { B2DataSource, B2StorageRepository } from '@laikacms/backblaze/storage-b2';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

/**
 * B2_KEY_ID          — Backblaze application key ID (visible once at creation).
 * B2_APPLICATION_KEY — Backblaze application key secret.
 * B2_BUCKET_ID       — 10-char bucket ID from the B2 dashboard.
 * B2_BUCKET_NAME     — Human-readable bucket name (used in download URLs).
 * B2_BASE_PATH       — Subfolder within the bucket. Default: cms.
 * PORT               — HTTP port. Default: 3000.
 *
 * Five wire-format traits unique to Backblaze B2 native API:
 *   1. Two-phase upload — b2_get_upload_url first, then POST to that URL.
 *   2. File versioning by default — deletes need (fileName + fileId), not just path.
 *   3. Mandatory SHA-1 — X-Bz-Content-Sha1 header required on every upload.
 *   4. Bare Authorization header — no Bearer/Basic prefix; raw token only.
 *   5. POST-for-everything — even list and metadata reads use POST with JSON body.
 *
 * Quick start:
 *   1. Create a bucket at backblaze.com (private, no public access needed).
 *   2. Create an application key with Read and Write permissions for the bucket.
 *   3. Copy .env.example → .env and fill in the four required values.
 *   4. pnpm dev
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const BUCKET_NAME = requireEnv('B2_BUCKET_NAME');

const dataSource = new B2DataSource({
  auth: {
    keyId: requireEnv('B2_KEY_ID'),
    applicationKey: requireEnv('B2_APPLICATION_KEY'),
  },
  bucketId: requireEnv('B2_BUCKET_ID'),
  bucketName: BUCKET_NAME,
});

const storage = new B2StorageRepository({
  dataSource,
  basePath: process.env['B2_BASE_PATH'] ?? 'cms',
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    raw: rawSerializer,
  },
  defaultFileExtension: 'md',
});

const decapConfig = minimalBlogConfig();

const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · Backblaze B2 Blog',
});

const PORT = Number(process.env['PORT'] ?? 3000);

const app = new Hono();

// Decap JSON:API
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Admin UI
app.get('/admin', c => c.redirect('/admin/'));
app.get('/admin/', c => c.html(ADMIN_HTML));

// Blog index
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
    });

  const items = posts
    .map(post => {
      const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const title = (post as { content?: { title?: string } }).content?.title ?? slug;
      const date = post.updatedAt
        ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
        : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${title}</a>${date}</li>`;
    })
    .join('\n      ');

  const body = posts.length === 0
    ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
    : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog · Backblaze B2</title></head>
<body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
  <h1>My Blog</h1>
  <p><small>Storage: Backblaze B2 · ${BUCKET_NAME}/${process.env['B2_BASE_PATH'] ?? 'cms'}</small></p>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`);
});

// Individual post
app.get('/blog/:slug', async c => {
  const slug = c.req.param('slug');

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof NotFoundError) return c.notFound();
    throw err;
  }

  const { title, date, description, body } = post.content as {
    title?: string,
    date?: string,
    description?: string,
    body?: string,
  };

  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time style="color:#666">${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`);
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`Backblaze B2 blog running at http://localhost:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`  Blog:   http://localhost:${info.port}/`);
  // eslint-disable-next-line no-console
  console.log(`  Admin:  http://localhost:${info.port}/admin/`);
  // eslint-disable-next-line no-console
  console.log(`  Bucket: ${BUCKET_NAME}/${process.env['B2_BASE_PATH'] ?? 'cms'}`);
});
