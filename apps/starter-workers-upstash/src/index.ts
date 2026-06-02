import { createCustomLaika } from '@laikacms/decap-integrations/custom';
import { UpstashRedisStorageRepository } from '@laikacms/upstash/storage-redis';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { ADMIN_HTML } from './admin.js';
import { blogCollections } from './decap-config.js';

export interface Env {
  /** Upstash REST endpoint — set via `wrangler secret put UPSTASH_REDIS_REST_URL`. */
  UPSTASH_REDIS_REST_URL: string;
  /** Upstash REST token — set via `wrangler secret put UPSTASH_REDIS_REST_TOKEN`. */
  UPSTASH_REDIS_REST_TOKEN: string;
}

/**
 * Create one LaikaCMS instance per request. Workers isolates are torn down
 * between requests; UpstashRedisStorageRepository is stateless (each method
 * call fires an independent `fetch`), so per-request construction is fast.
 *
 * This is also the canonical demonstration that createCustomLaika works in
 * Cloudflare Workers — it has no Node.js imports and is compatible with V8
 * isolates and other edge runtimes.
 */
const makeLaika = (env: Env) => {
  const storage = new UpstashRedisStorageRepository({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    serializerRegistry: {
      md: markdownSerializer,
      yaml: yamlSerializer,
      yml: yamlSerializer,
      json: jsonSerializer,
      raw: rawSerializer,
    },
    defaultFileExtension: 'md',
  });

  return createCustomLaika({
    storage,
    decapConfig: {
      backend: { name: 'laika', api_url: '/api/decap' },
      media_folder: 'uploads',
      public_folder: '/uploads',
      collections: blogCollections,
    },
    basePath: '/api/decap',
    auth: { mode: 'dev' },
  });
};

const app = new Hono<{ Bindings: Env }>();

app.get('/admin', c => c.html(ADMIN_HTML));
app.get('/admin/', c => c.html(ADMIN_HTML));

app.all('/api/decap/*', c => {
  const laika = makeLaika(c.env);
  return laika.fetch(c.req.raw);
});

app.get('/', async c => {
  const laika = makeLaika(c.env);
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
      const date = post.updatedAt ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>` : '';
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
    })
    .join('\n      ');

  const body = posts.length === 0
    ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
    : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title></head>
<body>
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin">Admin →</a></p>
</body>
</html>`);
});

app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();
  const laika = makeLaika(c.env);
  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    return c.notFound();
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
<body>
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`);
});

export default app;
