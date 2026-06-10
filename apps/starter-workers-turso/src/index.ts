import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { LibSqlDataSource, LibSqlStorageRepository } from '@laikacms/libsql/storage-libsql';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';

export interface Env {
  /** Turso database URL. Plain var — not a secret. Example: https://<db>.turso.io */
  LIBSQL_URL: string;
  /** Turso auth token. Set via `wrangler secret put LIBSQL_AUTH_TOKEN`. */
  LIBSQL_AUTH_TOKEN?: string;
  /** Optional table name override (default: laika_storage). */
  LIBSQL_TABLE?: string;
}

const ADMIN_HTML = decapAdminHtml();

/**
 * One LaikaCMS instance per request. LibSqlDataSource is stateless — every
 * method call fires an independent fetch() to the Turso HTTP endpoint. There
 * are no persistent connections to reuse, so per-request construction is free.
 */
const makeLaika = (env: Env) => {
  const dataSource = new LibSqlDataSource({
    url: env.LIBSQL_URL,
    auth: env.LIBSQL_AUTH_TOKEN ? { token: env.LIBSQL_AUTH_TOKEN } : undefined,
  });

  const storage = new LibSqlStorageRepository({
    dataSource,
    tableName: env.LIBSQL_TABLE ?? 'laika_storage',
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

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-workers-turso',
    endpoints: {
      'GET /': 'this index',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API',
      'GET /posts': 'list published posts',
      'GET /posts/:slug': 'single post',
    },
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.get('/admin/', c => c.html(ADMIN_HTML));

app.all('/api/decap/*', c => {
  const laika = makeLaika(c.env);
  return laika.fetch(c.req.raw);
});

app.get('/posts', async c => {
  const laika = makeLaika(c.env);
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  const posts = items
    .filter(item => item.type === 'published')
    .map(item => ({
      key: (item as { key: string }).key,
      content: (item as { content?: unknown }).content,
    }));
  return c.json({ posts });
});

app.get('/posts/:slug', async c => {
  const slug = c.req.param('slug');
  const laika = makeLaika(c.env);
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

export default app;
