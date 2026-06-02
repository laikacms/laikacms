import { serve } from '@hono/node-server';
import { D1StorageRepository, schemaDdl } from '@laikacms/cloudflare/storage-d1';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

/**
 * CF_ACCOUNT_ID   — Cloudflare account ID (visible in dashboard URL).
 * CF_D1_DATABASE_ID — UUID of the D1 database (Dashboard → D1 → your DB).
 * CF_D1_API_TOKEN — Cloudflare API token with D1 read+write permissions.
 * PORT            — HTTP port for this blog server. Default: 3000.
 *
 * Quick start:
 *   1. Create a D1 database in the Cloudflare dashboard (or via wrangler):
 *        wrangler d1 create laika-blog
 *   2. Copy the account ID and database UUID from the output.
 *   3. Create an API token at dash.cloudflare.com/profile/api-tokens
 *      with "D1 Edit" permission scoped to your account.
 *   4. Run the one-time DDL migration to create the table:
 *        curl -X POST http://localhost:3000/setup  (once the server is running)
 *   5. CF_ACCOUNT_ID=... CF_D1_DATABASE_ID=... CF_D1_API_TOKEN=... pnpm dev
 *
 * D1 is Cloudflare's serverless SQLite — globally distributed, accessible
 * via the REST API from any runtime (including plain Node.js).
 */

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

const storage = new D1StorageRepository({
  auth: { apiToken: requireEnv('CF_D1_API_TOKEN') },
  accountId: requireEnv('CF_ACCOUNT_ID'),
  databaseId: requireEnv('CF_D1_DATABASE_ID'),
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
  title: 'Admin · D1 Blog',
});

const PORT = Number(process.env['PORT'] ?? 3000);

const app = new Hono();

// One-time DDL — run once to create the laika_storage table.
app.post('/setup', async c => {
  const ddl = schemaDdl();
  try {
    // D1StorageRepository doesn't expose execute directly, so call the REST
    // API ourselves using the same credentials.
    const token = requireEnv('CF_D1_API_TOKEN');
    const accountId = requireEnv('CF_ACCOUNT_ID');
    const databaseId = requireEnv('CF_D1_DATABASE_ID');
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql: ddl, params: [] }),
      },
    );
    const data = await res.json() as { success: boolean, errors?: unknown[] };
    if (!data.success) {
      return c.json({ ok: false, errors: data.errors }, 500);
    }
    return c.json({ ok: true, message: 'Table created (or already existed).' });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Decap JSON:API — forward all /api/decap/* to laika.fetch.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Decap CMS admin shell.
app.get('/admin', c => c.html(ADMIN_HTML));

// Blog index — list all posts.
app.get('/', async c => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      folder: 'posts',
      depth: 1,
      pagination: { page: 1, perPage: 100 },
      type: 'published',
    }),
  );
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>D1 Blog</title></head>
<body>
<h1>D1 Blog</h1>
<p>Storage: <strong>Cloudflare D1</strong> (serverless SQLite) · <a href="/admin">Admin</a></p>
<ul>
${items.map(p => `  <li><a href="/blog/${p.key.split('/').pop()}">${p.key}</a></li>`).join('\n')}
</ul>
</body>
</html>`;
  return c.html(html);
});

// Blog post detail page.
app.get('/blog/:slug', async c => {
  const slug = c.req.param('slug');
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const { title, body } = doc.content as { title?: string, body?: string };
    const postTitle = title ?? slug;
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${postTitle}</title></head>
<body>
<h1>${postTitle}</h1>
<pre>${body ?? ''}</pre>
<p><a href="/">← All posts</a></p>
</body>
</html>`);
  } catch (err) {
    if (err instanceof NotFoundError) return c.notFound();
    throw err;
  }
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`starter-d1-blog running on http://localhost:${PORT}`);
  console.log('  POST /setup to provision the D1 table on first run');
});
