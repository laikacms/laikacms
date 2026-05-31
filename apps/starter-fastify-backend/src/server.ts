import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { mountWebFetchHandler } from './lib/fastify-fetch-adapter.js';
import { laika } from './lib/laika.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_HTML = readFileSync(resolve(__dirname, 'admin/index.html'), 'utf8');

const fastify = Fastify({ logger: true });

// Wildcard content type parser that just passes through raw streams without
// parsing — the web-standard adapter needs the raw body.
fastify.addContentTypeParser('*', (_request, _payload, done) => {
  done(null, undefined);
});

fastify.get('/', async () => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return {
    name: '@laikacms/starter-fastify-backend',
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

fastify.get('/admin', async (_req, reply) => {
  reply.type('text/html');
  return ADMIN_HTML;
});

// Mount the LaikaCMS web-standard fetch handler at /api/decap/*.
fastify.all('/api/decap/*', mountWebFetchHandler(req => laika.fetch(req)));

fastify.get('/posts', async () => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return {
    posts: items
      .filter(item => item.type === 'published')
      .map(item => ({
        key: (item as { key: string }).key,
        content: (item as { content?: unknown }).content,
      })),
  };
});

fastify.get<{ Params: { slug: string } }>('/posts/:slug', async (req, reply) => {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${req.params.slug}`));
    return { post: doc };
  } catch (err) {
    if (err instanceof NotFoundError) {
      reply.status(404);
      return { error: 'Not found' };
    }
    throw err;
  }
});

try {
  await fastify.listen({ port: PORT });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
