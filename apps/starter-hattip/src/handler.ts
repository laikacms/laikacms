/**
 * The runtime-agnostic Hattip handler.
 *
 * This file knows nothing about Node, Bun, Workers, etc. It exports a single
 * `(context) => Response` function that takes a web-standard Request and
 * returns a web-standard Response. The adapter files (node-entry, worker-entry,
 * etc.) wire this into the host runtime.
 */
import { compose } from '@hattip/compose';
import { createRouter } from '@hattip/router';

import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

const decapConfig = minimalBlogConfig();

// FileSystem is fine on Node/Bun/Deno. For Workers/Lambda swap in
// createCustomLaika + R2/S3/GitHub storage at the top of THIS file — every
// runtime entry below picks it up unchanged.
const laika = createEmbeddedLaika({
  contentDir: `${process.cwd()}/content`,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Hattip starter',
});

const router = createRouter();

router.get('/', () =>
  new Response(
    JSON.stringify({
      name: '@laikacms/starter-hattip',
      runtime: 'Hattip — write once, deploy anywhere',
      endpoints: {
        'GET /': 'this index',
        'GET /admin': 'Decap CMS admin shell',
        'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
        'GET /posts': 'public list of published posts',
        'GET /posts/:slug': 'public single-post endpoint',
      },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  ));

router.get('/admin', () => new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));

// Catch-all for /api/decap/* across every HTTP method. The Hattip router
// doesn't have a `.all()` helper, so we register each method explicitly.
const decapHandler = ({ request }: { request: Request }) => laika.fetch(request);
for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options'] as const) {
  router[method]('/api/decap/*', decapHandler);
}

router.get('/posts', async () => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return new Response(
    JSON.stringify({
      posts: items
        .filter(item => item.type === 'published')
        .map(item => ({
          key: (item as { key: string }).key,
          content: (item as { content?: unknown }).content,
        })),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});

router.get<{ slug: string }>('/posts/:slug', async ({ params }) => {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${params.slug}`));
    return new Response(JSON.stringify({ post: doc }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw err;
  }
});

export const handler = compose(router.buildHandler());
