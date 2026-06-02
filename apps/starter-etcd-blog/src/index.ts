import { serve } from '@hono/node-server';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { EtcdDataSource, EtcdStorageRepository } from '@laikacms/etcd/storage-etcd';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

/**
 * ETCD_URL   — etcd gRPC-gateway HTTP endpoint. Default: http://localhost:2379
 * ETCD_TOKEN — Bearer token when etcd authentication is enabled (optional).
 * PORT       — HTTP port. Default: 3000.
 *
 * Quick start (Docker, auth disabled — default Bitnami image):
 *   docker run -p 2379:2379 bitnami/etcd:latest -e ALLOW_NONE_AUTHENTICATION=yes
 *   pnpm dev
 *
 * Three etcd-specific traits this starter exercises:
 *   1. Base64 wire encoding — every key and value is b64-encoded in the JSON
 *      gateway; the data source wraps every crossing automatically.
 *   2. Prefix range scans — no ?prefix= param; list scans use [key, range_end)
 *      pairs where range_end increments the last byte of the prefix.
 *   3. Txn as the atomic primitive — createObject uses CAS (compare:
 *      createRevision==0); removeAtoms(N) packs N ops into one Txn.
 */
const ETCD_URL = process.env['ETCD_URL'] ?? 'http://localhost:2379';
const ETCD_TOKEN = process.env['ETCD_TOKEN'];

const dataSource = new EtcdDataSource({
  url: ETCD_URL,
  // auth is optional — undefined is fine for etcd running without auth
  auth: ETCD_TOKEN ? { token: ETCD_TOKEN } : undefined,
});

const storage = new EtcdStorageRepository({
  dataSource,
  basePath: '/laika',
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
  title: 'Admin · etcd Blog',
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
<head><meta charset="utf-8"><title>My Blog · etcd</title></head>
<body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
  <h1>My Blog</h1>
  <p><small>Storage: etcd · ${ETCD_URL}/laika</small></p>
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
  console.log(`etcd blog running at http://localhost:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`  Blog:  http://localhost:${info.port}/`);
  // eslint-disable-next-line no-console
  console.log(`  Admin: http://localhost:${info.port}/admin/`);
  // eslint-disable-next-line no-console
  console.log(`  etcd:  ${ETCD_URL}`);
});
