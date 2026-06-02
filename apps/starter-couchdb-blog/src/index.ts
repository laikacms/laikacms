import { serve } from '@hono/node-server';
import { CouchDbDataSource, CouchDbStorageRepository } from '@laikacms/couchdb/storage-couchdb';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

/**
 * COUCHDB_URL      — CouchDB HTTP endpoint including the database name.
 *                    Default: http://localhost:5984/laikacms
 *                    Format:  http(s)://host:port/database-name
 * COUCHDB_USERNAME — HTTP Basic username.
 * COUCHDB_PASSWORD — HTTP Basic password.
 * COUCHDB_BEARER   — Bearer JWT (IBM Cloudant IAM; takes precedence over Basic).
 * PORT             — HTTP port for this blog server. Default: 3000.
 *
 * Quick start (local dev with Docker):
 *   docker run -p 5984:5984 -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password couchdb
 *   curl -u admin:password -X PUT http://localhost:5984/laikacms
 *   COUCHDB_USERNAME=admin COUCHDB_PASSWORD=password pnpm dev
 *
 * IBM Cloudant:
 *   COUCHDB_URL=https://acct.cloudant.com/laikacms \
 *   COUCHDB_BEARER=<iam-token> \
 *   pnpm dev
 *
 * CouchDB is schema-free — no migrations needed. The first write creates
 * the document; the _rev field is CouchDB's optimistic-concurrency token.
 */
const COUCH_URL = process.env['COUCHDB_URL'] ?? 'http://localhost:5984/laikacms';
const COUCH_BEARER = process.env['COUCHDB_BEARER'];
const COUCH_USERNAME = process.env['COUCHDB_USERNAME'];
const COUCH_PASSWORD = process.env['COUCHDB_PASSWORD'];

// CouchDbAuth doesn't have a `bearer` field — pass Bearer tokens via
// `authorizationHeader`. `auth` is required; empty object works for
// CouchDB running in "admin party" mode (no auth configured).
const auth = COUCH_BEARER
  ? { authorizationHeader: `Bearer ${COUCH_BEARER}` }
  : COUCH_USERNAME && COUCH_PASSWORD
  ? { basic: { username: COUCH_USERNAME, password: COUCH_PASSWORD } }
  : {};

const dataSource = new CouchDbDataSource({ url: COUCH_URL, auth });

const storage = new CouchDbStorageRepository({
  dataSource,
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
  title: 'Admin · CouchDB Blog',
});

const PORT = Number(process.env['PORT'] ?? 3000);

const app = new Hono();

// Decap JSON:API — forward all /api/decap/* to laika.fetch.
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
<head><meta charset="utf-8"><title>My Blog · CouchDB</title></head>
<body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
  <h1>My Blog</h1>
  <p><small>Storage: Apache CouchDB · ${COUCH_URL}</small></p>
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
  console.log(`CouchDB blog running at http://localhost:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`  Blog:    http://localhost:${info.port}/`);
  // eslint-disable-next-line no-console
  console.log(`  Admin:   http://localhost:${info.port}/admin/`);
  // eslint-disable-next-line no-console
  console.log(`  CouchDB: ${COUCH_URL}`);
});
