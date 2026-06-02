import { resolve } from 'node:path';

import { serve } from '@hono/node-server';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { createDrizzleStorage } from './db/repo.js';

const PORT = Number(process.env.PORT ?? 3000);
const DB_URL = process.env.DB_URL ?? `file:${resolve(process.cwd(), 'laikacms.db')}`;

// DrizzleStorageRepository is async to instantiate (CREATE TABLE on boot),
// so we await before wiring the preset. Once we have a StorageRepository,
// `createCustomLaika` handles the rest — same shape as `createEmbeddedLaika`
// and `createWorkersLaika`, but BYO storage.
const storage = await createDrizzleStorage(DB_URL);
const decapConfig = minimalBlogConfig();

const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  // seedConfigOnFirstRequest defaults to true — writes config.yml into SQL
  // on first request if missing.
});

const documents = laika.documents;

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Drizzle starter',
});

const app = new Hono();

app.get('/', async c =>
  c.json({
    name: '@laikacms/starter-drizzle-sqlite',
    runtime: `Node.js ${process.version}`,
    storage: `DrizzleStorageRepository / libsql @ ${DB_URL}`,
    endpoints: {
      'GET /': 'this index',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
      'GET /posts': 'public list of published posts',
      'GET /posts/:slug': 'public single-post endpoint',
    },
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.get('/posts', async c => {
  const { items } = await collectStream(
    documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return c.json({
    posts: items
      .filter(item => item.type === 'published')
      .map(item => ({
        key: (item as { key: string }).key,
        content: (item as { content?: unknown }).content,
      })),
  });
});

app.get('/posts/:slug', async c => {
  try {
    const doc = await runTask(documents.getDocument(`posts/${c.req.param('slug')}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Drizzle/SQLite backend listening on http://localhost:${info.port}`);
  console.log(`Storage: ${DB_URL}`);
});
