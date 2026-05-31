import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Router from '@koa/router';
import Koa from 'koa';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { mountWebFetchHandler } from './lib/koa-fetch-adapter.js';
import { laika } from './lib/laika.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_HTML = readFileSync(resolve(__dirname, 'admin/index.html'), 'utf8');

const app = new Koa();
const router = new Router();

// IMPORTANT: do NOT mount `koa-bodyparser` in front of /api/decap/* — it
// would drain the request body before the adapter streams it to laika.fetch.

router.get('/', async ctx => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  ctx.body = {
    name: '@laikacms/starter-koa-backend',
    runtime: `Node.js ${process.version}`,
    endpoints: {
      'GET /': 'this index',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required, web-standard adapter)',
      'GET /posts': 'public list of published posts',
      'GET /posts/:slug': 'public single-post endpoint',
    },
    samplePostsCount: items.length,
  };
});

router.get('/admin', ctx => {
  ctx.type = 'html';
  ctx.body = ADMIN_HTML;
});

// Wildcard with `(.*)` is the @koa/router convention for "match everything
// remaining in the path".
router.all('/api/decap/(.*)', mountWebFetchHandler(req => laika.fetch(req)));

router.get('/posts', async ctx => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  ctx.body = {
    posts: items
      .filter(item => item.type === 'published')
      .map(item => ({
        key: (item as { key: string }).key,
        content: (item as { content?: unknown }).content,
      })),
  };
});

router.get('/posts/:slug', async ctx => {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${ctx.params.slug}`));
    ctx.body = { post: doc };
  } catch (err) {
    if (err instanceof NotFoundError) {
      ctx.status = 404;
      ctx.body = { error: 'Not found' };
      return;
    }
    throw err;
  }
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Koa backend listening on http://localhost:${PORT}`);
});
