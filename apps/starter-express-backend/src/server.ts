import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { mountWebFetchHandler } from './lib/express-fetch-adapter.js';
import { laika } from './lib/laika.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_HTML = readFileSync(resolve(__dirname, 'admin/index.html'), 'utf8');

const app = express();

// IMPORTANT: do NOT mount `express.json()` globally — it would drain the
// request body before our /api/decap/* handler streams it to laika.fetch.
// Body parsers can still be used on other routes if needed.

app.get('/', async (_req, res) => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  res.json({
    name: '@laikacms/starter-express-backend',
    runtime: `Node.js ${process.version}`,
    endpoints: {
      'GET /': 'this index',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required, web-standard adapter)',
      'GET /posts': 'public list of published posts',
      'GET /posts/:slug': 'public single-post endpoint',
    },
    samplePostsCount: items.length,
  });
});

app.get('/admin', (_req, res) => res.type('html').send(ADMIN_HTML));

// The decap route uses the web-standard adapter — no body parser in the chain.
app.all('/api/decap/*', mountWebFetchHandler(req => laika.fetch(req)));

app.get('/posts', async (_req, res) => {
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
  res.json({ posts });
});

app.get('/posts/:slug', async (req, res) => {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${req.params.slug}`));
    res.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: 'Not found' });
    throw err;
  }
});

// Basic error handler so the adapter's `next(err)` lands somewhere.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Express backend listening on http://localhost:${PORT}`);
});
