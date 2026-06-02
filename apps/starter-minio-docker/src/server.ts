import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { serve } from '@hono/node-server';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { createS3Bucket } from 'laikacms/storage-s3';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

const PORT = Number(process.env.PORT ?? 3000);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: requireEnv('S3_ACCESS_KEY'),
    secretAccessKey: requireEnv('S3_SECRET_KEY'),
  },
});

// The AWS SDK command constructors satisfy the createS3Bucket commands
// surface at runtime — they accept the same input shape (Bucket, Key, etc.).
// The static types differ in optional/required markers; cast at this
// boundary rather than perfectly unifying both sides.
type Commands = Parameters<typeof createS3Bucket>[0]['commands'];
const bucket = createS3Bucket({
  client: s3 as Parameters<typeof createS3Bucket>[0]['client'],
  bucketName: requireEnv('S3_BUCKET'),
  commands: {
    HeadObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
  } as unknown as Commands,
});

// R2StorageRepository drives the full document/asset lifecycle over our S3
// bucket. createCustomLaika wires the rest (settings provider, ContentBase
// repos, decapApi).
const storage = new R2StorageRepository(
  // Type bridge: the bucket structurally satisfies the R2Bucket interface
  // R2StorageRepository expects, but the workers-types `R2Bucket` is wider.
  // Cast at the boundary; behavior at runtime is correct.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bucket as any,
  {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    txt: rawSerializer,
  },
  'md',
);

const decapConfig = minimalBlogConfig();
const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS MinIO + Docker starter',
});

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-minio-docker',
    storage: `MinIO via S3 (endpoint: ${process.env.S3_ENDPOINT ?? 'aws default'} / bucket: ${
      requireEnv('S3_BUCKET')
    })`,
    note: 'Powered by the first-party laikacms/storage-s3 adapter — full read/write/list works.',
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
  console.log(`LaikaCMS MinIO backend listening on http://localhost:${info.port}`);
});
