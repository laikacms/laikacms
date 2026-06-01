import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { marked } from 'marked';

import { decapConfig, laika } from './laika.js';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';

const app = new Hono();

// ── Decap JSON:API ────────────────────────────────────────────────────────────
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// ── Media serving ─────────────────────────────────────────────────────────────
//
// When Decap CMS uploads an image it goes through the laika assets API and is
// stored base64-encoded as a JSON object in the contentbase. The markdown body
// then references the image as ![alt](/uploads/filename.jpg) (via public_folder).
//
// This route decodes the stored asset and responds with the raw binary so
// browsers can load images normally. The storage key is derived from the URL:
//   /uploads/photo.jpg  →  public/uploads/photo.jpg
//
// Why not serve from ./public? Laika's ContentBaseAssetsRepository stores
// binaries as base64 JSON via StorageRepository — not as native files on disk.
// The only way to serve them is by reading the object and decoding the payload.
app.get('/uploads/:filename', async c => {
  const { filename } = c.req.param();
  const storageKey = `public/uploads/${filename}`;

  let obj: { content: Record<string, unknown> };
  try {
    obj = await runTask(laika.storage.getObject(storageKey));
  } catch {
    return c.notFound();
  }

  const base64 = obj.content['data'];
  const mimeType = obj.content['mimeType'];
  if (typeof base64 !== 'string' || typeof mimeType !== 'string') {
    return c.notFound();
  }

  const bytes = Buffer.from(base64, 'base64');
  return new Response(bytes, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(bytes.byteLength),
    },
  });
});

// ── Blog index ────────────────────────────────────────────────────────────────
app.get('/', async c => {
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  const posts = records
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      const da = a.updatedAt ?? '';
      const db = b.updatedAt ?? '';
      return db.localeCompare(da);
    });

  const items = posts
    .map(post => {
      const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const date = post.updatedAt
        ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
        : '';
      return `<li><a href="/blog/${slug}">${slug}</a>${date}</li>`;
    })
    .join('\n');

  const body = posts.length === 0
    ? `<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post — try uploading an image in the body.</p>`
    : `<ul>${items}</ul>`;

  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Media Blog</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
    ul { list-style: none; padding: 0; }
    li { margin: .5rem 0; }
  </style>
</head>
<body>
  <h1>Media Blog</h1>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`);
});

// ── Single post ───────────────────────────────────────────────────────────────
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    return c.notFound();
  }

  if (post.type !== 'published') return c.notFound();

  const { title, date, body } = post.content as {
    title?: string,
    date?: string,
    body?: string,
  };

  // Render markdown so <img> tags appear for uploaded images.
  const html = await marked.parse(body ?? '');

  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title ?? slug}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
    img { max-width: 100%; height: auto; border-radius: 4px; }
  </style>
</head>
<body>
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    <div class="prose">${html}</div>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`);
});

// ── Decap admin ───────────────────────────────────────────────────────────────
app.get('/admin', c =>
  c.html(decapAdminHtml({ decapConfig, title: 'Media Blog · Admin' })),
);
app.get('/admin/', c =>
  c.html(decapAdminHtml({ decapConfig, title: 'Media Blog · Admin' })),
);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Media blog running at http://localhost:${info.port}`);
  console.log(`  Blog:  http://localhost:${info.port}/`);
  console.log(`  Admin: http://localhost:${info.port}/admin/`);
  console.log(`  Images served from: /uploads/:filename`);
});
