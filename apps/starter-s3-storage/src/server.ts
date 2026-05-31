import { S3Client } from '@aws-sdk/client-s3';
import { serve } from '@hono/node-server';
import { createWorkersLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/workers';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { createS3BucketShim } from './s3-r2-adapter.js';

const PORT = Number(process.env.PORT ?? 3000);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Standard S3 client. Setting `endpoint` lets you target MinIO, Backblaze B2,
// Cloudflare R2 (via the S3 endpoint), DigitalOcean Spaces, etc.
const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT, // e.g. http://localhost:9000 for MinIO
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: requireEnv('S3_ACCESS_KEY'),
    secretAccessKey: requireEnv('S3_SECRET_KEY'),
  },
});

const bucket = createS3BucketShim(s3, requireEnv('S3_BUCKET'));

const decapConfig = minimalBlogConfig();
const laika = createWorkersLaika({
  bucket,
  decapConfig,
  basePath: '/api/decap',
  seedConfigOnFirstRequest: true,
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS S3-storage starter',
});

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-s3-storage',
    storage: `S3 (endpoint: ${process.env.S3_ENDPOINT ?? 'aws default'} / bucket: ${requireEnv('S3_BUCKET')})`,
    note:
      'PoC: S3 shim implements head+put only. For real content ops, a full S3StorageRepository is needed (see README).',
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
    laika.documents.listRecords({
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
    const doc = await runTask(laika.documents.getDocument(`posts/${c.req.param('slug')}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS S3-storage backend listening on http://localhost:${info.port}`);
});
