import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { LibSqlDataSource, LibSqlStorageRepository } from '@laikacms/libsql/storage-libsql';
import { Elysia } from 'elysia';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

function requireEnv(name: string): string {
  const value = process.env[name] ?? Bun.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * @laikacms/libsql uses @libsql/client which communicates with Turso via HTTP.
 * HTTP transport works on Bun without Node.js shims — no polyfills needed.
 *
 * Doc gap: clarify that LibSqlStorageRepository is Bun-compatible when using
 * Turso's cloud URL (HTTP). Local sqld (http://localhost:8080) also works.
 * The embedded libSQL file mode (file:./data.db) requires Bun's native SQLite
 * via starter-bun-sqlite instead.
 */
const dataSource = new LibSqlDataSource({
  url: requireEnv('LIBSQL_URL'),
  auth: { token: process.env['LIBSQL_AUTH_TOKEN'] ?? Bun.env['LIBSQL_AUTH_TOKEN'] },
});

const storage = new LibSqlStorageRepository({
  dataSource,
  tableName: process.env['LIBSQL_TABLE'] ?? Bun.env['LIBSQL_TABLE'] ?? 'laika_storage',
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

const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · Elysia + Turso Blog' });

/**
 * Elysia's context.request is a Web API Request — laika.fetch works with zero
 * adaptation. No IncomingMessage bridge needed (unlike Express or Fastify).
 */
const app = new Elysia()
  .all('/api/decap/*', ({ request }) => laika.fetch(request))
  .get('/admin', () => new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html' } }))
  .get('/', async () => {
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
      ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

    return new Response(
      `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog · Elysia + Turso</title></head>
<body>
  <h1>My Blog</h1>
  <p><small>Storage: LibSqlStorageRepository / Turso · Runtime: Bun</small></p>
  ${body}
  <p><a href="/admin">Admin →</a></p>
</body>
</html>`,
      { headers: { 'content-type': 'text/html' } },
    );
  })
  .get('/blog/:slug', async ({ params: { slug } }) => {
    let post;
    try {
      post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    } catch (err) {
      if (err instanceof NotFoundError) {
        return new Response('Post not found', { status: 404 });
      }
      throw err;
    }

    const { title, date, description, body } = post.content as {
      title?: string,
      date?: string,
      description?: string,
      body?: string,
    };

    return new Response(
      `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title></head>
<body>
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`,
      { headers: { 'content-type': 'text/html' } },
    );
  })
  .listen(Number(process.env['PORT'] ?? Bun.env['PORT'] ?? 3000));

console.log(`Elysia + Turso blog running at http://localhost:${app.server?.port}`);
console.log(`  Blog:    http://localhost:${app.server?.port}/`);
console.log(`  Admin:   http://localhost:${app.server?.port}/admin`);
