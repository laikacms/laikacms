import { serve } from '@hono/node-server';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { OneDriveDataSource, OneDriveStorageRepository } from '@laikacms/microsoft/storage-onedrive';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

/**
 * GRAPH_ACCESS_TOKEN  — Microsoft Graph OAuth 2.0 access token (required).
 *                       Needs Files.ReadWrite scope (delegated) or Files.ReadWrite.All (app-only).
 * ONEDRIVE_BASE_PATH  — Subfolder within the drive. Default: cms.
 * ONEDRIVE_DRIVE_PATH — Which drive to target. Default: /me/drive (signed-in user).
 *                       Override for SharePoint / other users:
 *                         /users/{userId}/drive  /drives/{driveId}  /sites/{siteId}/drive
 * PORT                — HTTP port. Default: 3000.
 *
 * Delegated access (device-code flow, easiest for dev):
 *   Register an app in Entra Portal → add Files.ReadWrite delegated permission →
 *   run device-code flow → paste token into .env.
 *
 * App-only access (service principal):
 *   Register an app → grant Files.ReadWrite.All application permission →
 *   acquire a token with client-credentials flow:
 *   GRAPH_ACCESS_TOKEN=<token> ONEDRIVE_DRIVE_PATH=/drives/<driveId> pnpm dev
 *
 * Three distinctive Microsoft Graph API traits:
 *   1. Native path addressing — /me/drive/root:/posts/hello.md: (no id lookup needed)
 *   2. $batch bulk-delete — removeAtoms(N) ships as one HTTP round-trip
 *   3. Pre-signed downloadUrl — content reads are unauthenticated CDN fetches
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const dataSource = new OneDriveDataSource({
  auth: {
    accessToken: requireEnv('GRAPH_ACCESS_TOKEN'),
  },
  drivePath: process.env['ONEDRIVE_DRIVE_PATH'],
});

const storage = new OneDriveStorageRepository({
  dataSource,
  basePath: process.env['ONEDRIVE_BASE_PATH'] ?? 'cms',
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
  title: 'Admin · OneDrive Blog',
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
<head><meta charset="utf-8"><title>My Blog · OneDrive</title></head>
<body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
  <h1>My Blog</h1>
  <p><small>Storage: Microsoft OneDrive via Graph API</small></p>
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
  console.log(`OneDrive blog running at http://localhost:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`  Blog:  http://localhost:${info.port}/`);
  // eslint-disable-next-line no-console
  console.log(`  Admin: http://localhost:${info.port}/admin/`);
});
