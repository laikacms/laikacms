/**
 * Deno blog server.
 *
 * Deno.serve() passes a WHATWG Request to the fetch handler — the same type
 * laika.fetch expects — so the Decap proxy is a single line with no bridging:
 *
 *   return laika.fetch(request);
 *
 * This is the same zero-adapter property as Bun.serve() and Cloudflare Workers.
 * Compare to Express/Fastify/Koa which require an IncomingMessage→Request bridge.
 *
 * Required Deno permissions (set in deno.json tasks):
 *   --allow-net   HTTP server + outbound fetch
 *   --allow-read  Read content/ and public/ directories
 *   --allow-write Write content/ files (Decap CRUD)
 */
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import { collectStream, runTask } from 'laikacms/compat';
import { LaikaError } from 'laikacms/core';

import { laika } from './lib/laika.ts';

const PUBLIC_DIR = resolve(import.meta.dirname!, '..', 'public');
const PORT = 3000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

async function servePublic(pathname: string): Promise<Response | null> {
  const filePath = resolve(PUBLIC_DIR, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (!filePath.startsWith(PUBLIC_DIR + '/') && filePath !== PUBLIC_DIR) return null;
  try {
    const bytes = await readFile(filePath);
    const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    return new Response(bytes, { headers: { 'Content-Type': mime } });
  } catch {
    return null;
  }
}

async function renderHome(): Promise<Response> {
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
      const date = post.updatedAt ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>` : '';
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
<body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

async function renderPost(slug: string): Promise<Response> {
  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof LaikaError) {
      return new Response('Not Found', { status: 404 });
    }
    throw err;
  }

  const { title, date, description, body } = post.content as PostContent;

  return new Response(
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time style="color:#666">${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
    <p><a href="/">← Back</a></p>
  </article>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

Deno.serve({ port: PORT }, async (request: Request) => {
  const url = new URL(request.url);

  // Decap JSON:API — Deno.serve's Request is already WHATWG-compatible:
  // no bridge needed, pass directly to laika.fetch.
  if (url.pathname.startsWith('/api/decap')) {
    return laika.fetch(request);
  }

  // Static files from public/ (admin bundle, uploads)
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/uploads')) {
    const file = await servePublic(url.pathname);
    return file ?? new Response('Not Found', { status: 404 });
  }

  if (url.pathname === '/') return renderHome();

  const postMatch = url.pathname.match(/^\/blog\/([^/]+)\/?$/);
  if (postMatch) return renderPost(postMatch[1]);

  return new Response('Not Found', { status: 404 });
});

console.log(`Blog: http://localhost:${PORT}`);
console.log(`Admin: http://localhost:${PORT}/admin/`);
