import { resolve } from 'node:path';

import { serve } from '@hono/node-server';
import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

const PORT = Number(process.env.PORT ?? 3001);

const decapConfig = minimalBlogConfig();

const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const app = new Hono();

// The new decapAdminHtml helper replaces the ~50 line static HTML file that
// every previous starter shipped. We render it once at boot.
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS Lit starter' });

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.get('/api/posts', async c => {
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

app.get('/api/posts/:slug', async c => {
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
  console.log(`LaikaCMS sidecar backend listening on http://localhost:${info.port}`);
});
