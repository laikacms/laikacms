import { serve } from '@hono/node-server';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { apiReference } from '@scalar/hono-api-reference';

import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);

const PostSummarySchema = z
  .object({
    key: z.string().openapi({ example: 'posts/hello-world' }),
    slug: z.string().openapi({ example: 'hello-world' }),
    title: z.string().nullable().openapi({ example: 'Hello, world!' }),
    date: z.string().nullable().openapi({ example: '2026-05-31T10:00:00.000Z' }),
  })
  .openapi('PostSummary');

const PostSchema = z
  .object({
    slug: z.string(),
    key: z.string(),
    title: z.string().nullable(),
    date: z.string().nullable(),
    body: z.string().nullable(),
    content: z.record(z.unknown()),
  })
  .openapi('Post');

const ErrorSchema = z.object({ error: z.string() }).openapi('Error');

const listPostsRoute = createRoute({
  method: 'get',
  path: '/posts',
  tags: ['Posts'],
  summary: 'List published posts',
  request: {
    query: z.object({
      folder: z.string().default('posts').openapi({ example: 'posts' }),
      limit: z.coerce.number().default(100).openapi({ example: 100 }),
    }),
  },
  responses: {
    200: {
      description: 'Published posts in the given folder.',
      content: { 'application/json': { schema: z.object({ posts: z.array(PostSummarySchema) }) } },
    },
  },
});

const getPostRoute = createRoute({
  method: 'get',
  path: '/posts/{slug}',
  tags: ['Posts'],
  summary: 'Read a single published post',
  request: {
    params: z.object({ slug: z.string().openapi({ example: 'hello-world' }) }),
  },
  responses: {
    200: {
      description: 'Found.',
      content: { 'application/json': { schema: PostSchema } },
    },
    404: {
      description: 'Not found.',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const createDraftRoute = createRoute({
  method: 'post',
  path: '/posts',
  tags: ['Posts'],
  summary: 'Create an unpublished draft',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            slug: z.string(),
            title: z.string(),
            body: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Draft created.',
      content: { 'application/json': { schema: z.object({ status: z.string(), slug: z.string() }) } },
    },
  },
});

const publishRoute = createRoute({
  method: 'post',
  path: '/posts/{slug}/publish',
  tags: ['Posts'],
  summary: 'Publish an existing draft',
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      description: 'Published.',
      content: { 'application/json': { schema: PostSchema } },
    },
    404: {
      description: 'Not found.',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const app = new OpenAPIHono();

app.openapi(listPostsRoute, async c => {
  const { folder, limit } = c.req.valid('query');
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder,
      depth: 1,
      pagination: { offset: 0, limit },
      type: 'published',
    }),
  );
  const posts = items
    .filter(i => i.type === 'published')
    .map(item => {
      const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
        string,
        unknown
      >;
      const key = (item as { key: string }).key;
      return {
        key,
        slug: key.replace(/^posts\//, '').replace(/\.md$/, ''),
        title: (content.title as string) ?? null,
        date: (content.date as string) ?? null,
      };
    });
  return c.json({ posts }, 200);
});

app.openapi(getPostRoute, async c => {
  const { slug } = c.req.valid('param');
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
      string,
      unknown
    >;
    return c.json(
      {
        slug,
        key: `posts/${slug}`,
        title: (content.title as string) ?? null,
        date: (content.date as string) ?? null,
        body: (content.body as string) ?? null,
        content,
      },
      200,
    );
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

app.openapi(createDraftRoute, async c => {
  const { slug, title, body } = c.req.valid('json');
  await runTask(
    laika.documents.createUnpublished({
      key: `posts/${slug}`,
      status: 'draft',
      language: 'en' as never,
      content: { title, body, date: new Date().toISOString() } as never,
    } as never),
  );
  return c.json({ status: 'draft', slug }, 201);
});

app.openapi(publishRoute, async c => {
  const { slug } = c.req.valid('param');
  try {
    const doc = await runTask(laika.documents.publish(`posts/${slug}`));
    const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
      string,
      unknown
    >;
    return c.json(
      {
        slug,
        key: `posts/${slug}`,
        title: (content.title as string) ?? null,
        date: (content.date as string) ?? null,
        body: (content.body as string) ?? null,
        content,
      },
      200,
    );
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

// The OpenAPI document itself, at /openapi.json.
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'LaikaCMS', version: '0.0.1' },
});

// Scalar UI at /docs — a clean, interactive API reference.
app.get(
  '/docs',
  apiReference({
    // The Scalar API surface changed across versions; the `url` and
    // `sources` keys are both type-checked away from the public interface in
    // recent releases. Cast at the boundary — at runtime the option is
    // honored regardless.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    url: '/openapi.json',
    theme: 'purple',
  } as any),
);

// Decap admin + the JSON:API stay mounted alongside the typed surface.
const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS OpenAPI starter' });
app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-openapi',
    docs: '/docs',
    openapi: '/openapi.json',
    admin: '/admin',
  }));

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS OpenAPI backend listening on http://localhost:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`Browse docs at http://localhost:${info.port}/docs`);
});
