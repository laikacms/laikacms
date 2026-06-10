import { collectStream, runTask } from 'laikacms/compat';
import { LaikaError } from 'laikacms/core';

import { ADMIN_HTML, laika } from './lib/laika.ts';

const PORT = Number(Deno.env.get('PORT') ?? 3000);

/**
 * Deno.serve() passes a WHATWG Request directly to the handler — the same type
 * laika.fetch expects — so no bridge is needed. Compare to Express/Fastify/Koa
 * which require an IncomingMessage→Request adapter.
 */
Deno.serve({ port: PORT }, async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const { pathname } = url;

  // Decap JSON:API proxy — WHATWG Request passes through directly
  if (pathname.startsWith('/api/decap/')) {
    return laika.fetch(request);
  }

  // Admin UI — decapAdminHtml() generates the full page; no esbuild step
  if (pathname === '/admin' || pathname === '/admin/') {
    return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  // Blog index
  if (pathname === '/') {
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
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });

    const items = posts
      .map(post => {
        const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
        const title = (post as { content?: { title?: string } }).content?.title ?? slug;
        const date = post.updatedAt
          ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
          : '';
        return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${title}</a>${date}</li>`;
      })
      .join('\n      ');

    const body = posts.length === 0
      ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

    return new Response(
      `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog · Deno + Turso</title></head>
<body>
  <h1>My Blog</h1>
  <p><small>Storage: LibSqlStorageRepository / Turso · Runtime: Deno</small></p>
  ${body}
  <p><a href="/admin">Admin →</a></p>
</body>
</html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }

  // Individual post
  const blogMatch = pathname.match(/^\/blog\/([^/]+)$/);
  if (blogMatch) {
    const slug = blogMatch[1];
    try {
      const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
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
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    } catch (err) {
      if (err instanceof LaikaError) {
        return new Response('Post not found', { status: 404 });
      }
      throw err;
    }
  }

  return new Response('Not found', { status: 404 });
});

console.log(`Deno + Turso blog running at http://localhost:${PORT}`);
console.log(`  Blog:    http://localhost:${PORT}/`);
console.log(`  Admin:   http://localhost:${PORT}/admin`);
