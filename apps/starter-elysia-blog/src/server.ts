import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

/**
 * Elysia handler context includes `request` — the native WHATWG Request.
 * laika.fetch accepts a Web API Request directly, so no Node.js adapter is needed.
 * This is the same zero-adaptation story as Hono, Cloudflare Workers, and Bun.serve.
 *
 * Doc gap: document that WHATWG-native runtimes (Bun, Cloudflare Workers, Deno)
 * and WHATWG-native frameworks (Hono, Elysia) can call laika.fetch(request)
 * directly, while Node.js http/express/fastify frameworks need a Request adapter.
 */
const app = new Elysia()
  // Decap JSON:API — context.request is already a WHATWG Request.
  .all('/api/decap/*', ({ request }) => laika.fetch(request))
  // Blog index — list published posts via laika.documents.
  .get('/', async () => {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    type PostSummary = { type: string, key: string, updatedAt?: string };

    const posts = (records as PostSummary[])
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });

    const items = posts
      .map(post => {
        const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
        const date = post.updatedAt
          ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
          : '';
        return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
      })
      .join('\n      ');

    const body = posts.length === 0
      ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

    return new Response(
      `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title></head>
<body>
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  })
  // Individual blog post.
  .get('/blog/:slug', async ({ params: { slug } }) => {
    let post;
    try {
      post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    } catch {
      return new Response('Not found', { status: 404 });
    }

    const { title, date, description, body } = post.content as {
      title?: string,
      date?: string,
      description?: string,
      body?: string,
    };

    return new Response(
      `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title></head>
<body>
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  })
  // Static files from public/ — serves /admin/index.html, /admin/bundle.js, /uploads/*.
  .use(staticPlugin({ assets: 'public', prefix: '/' }))
  .listen(Number(process.env.PORT ?? 3000), ({ port }) => {
    console.log(`Elysia blog running at http://localhost:${port}`);
    console.log(`  Blog:  http://localhost:${port}/`);
    console.log(`  Admin: http://localhost:${port}/admin/`);
  });

export type App = typeof app;
