import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';

import { collectStream, runTask } from 'laikacms/compat';
import { buffer, send, serve } from 'micro';

import { laika } from './lib/laika.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const PUBLIC_DIR = resolve(process.cwd(), 'public');

/**
 * Bridge a Node.js IncomingMessage to a WHATWG Request using micro's buffer().
 *
 * micro.buffer() is a convenience wrapper around the manual "for await" loop:
 *   const chunks = [];
 *   for await (const chunk of req) chunks.push(chunk);
 *   const body = Buffer.concat(chunks);
 *
 * Doc gap: micro.buffer() is the most concise way to drain a Node.js HTTP
 * request stream. You don't need micro for anything else — it can be copied
 * as a standalone utility:
 *
 *   import { buffer } from 'micro';
 *   const buf = await buffer(req);
 *
 * This differs from Express (stream draining in handler) and Hapi
 * (payload.output:'data' option) — three ways to do the same thing.
 */
async function toLaikaRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers['host'] ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const method = (req.method ?? 'GET').toUpperCase();

  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const buf = await buffer(req, { limit: '10mb' });
    if (buf.byteLength > 0) {
      // TypeScript 6 regression: Buffer<ArrayBufferLike> is not assignable to BodyInit.
      body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }
  }

  return new Request(url, {
    method,
    headers: req.headers as HeadersInit,
    body: body ?? null,
    ...(body !== undefined ? { duplex: 'half' } : {}),
  } as RequestInit);
}

async function sendWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
  });
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, prefix: string): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const rel = url.pathname.slice(prefix.length) || 'index.html';
  let filePath = join(PUBLIC_DIR, prefix.slice(1), rel);

  if (!existsSync(filePath) && !rel.includes('.')) {
    filePath = join(PUBLIC_DIR, prefix.slice(1), rel, 'index.html');
  }
  if (!existsSync(filePath)) return false;

  const ext = filePath.split('.').pop() ?? '';
  const mime: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    js: 'application/javascript',
    css: 'text/css',
    png: 'image/png',
    jpg: 'image/jpeg',
    svg: 'image/svg+xml',
    json: 'application/json',
  };
  res.setHeader('content-type', mime[ext] ?? 'application/octet-stream');
  createReadStream(filePath).pipe(res);
  return true;
}

async function renderHome(): Promise<string> {
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

  const listHtml = posts.length === 0
    ? `<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>`
    : `<ul style="list-style:none;padding:0">${
      posts
        .map(post => {
          const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
          const date = post.updatedAt ? new Date(post.updatedAt).toLocaleDateString() : '';
          return `<li style="margin-bottom:1.5rem"><a href="/blog/${slug}">${slug}</a>${
            date ? ` · <time>${date}</time>` : ''
          }</li>`;
        })
        .join('')
    }</ul>`;

  return page(`<h1>My Blog</h1>${listHtml}`, 'My Blog');
}

async function renderPost(slug: string): Promise<string | null> {
  try {
    const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const { title, date, description, body } = post.content as {
      title?: string,
      date?: string,
      description?: string,
      body?: string,
    };
    const dateHtml = date ? `<time>${new Date(date).toLocaleDateString()}</time>` : '';
    const descHtml = description ? `<p><em>${esc(description)}</em></p>` : '';
    return page(
      `<article>
  <h1>${esc(title ?? slug)}</h1>
  ${dateHtml}
  ${descHtml}
  <pre style="white-space:pre-wrap;font-family:inherit">${esc(body ?? '')}</pre>
</article>
<p><a href="/">← Back</a></p>`,
      title ?? slug,
    );
  } catch {
    return null;
  }
}

function page(body: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:2rem 1rem}</style>
</head>
<body>${body}</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const handler = serve(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers['host'] ?? 'localhost'}`);

  if (url.pathname.startsWith('/api/decap')) {
    const webReq = await toLaikaRequest(req);
    const webRes = await laika.fetch(webReq);
    await sendWebResponse(webRes, res);
    return;
  }

  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/uploads')) {
    const prefix = url.pathname.startsWith('/admin') ? '/admin' : '/uploads';
    const served = await serveStatic(req, res, prefix);
    if (!served) send(res, 404, 'Not Found');
    return;
  }

  if (url.pathname === '/') {
    const html = await renderHome();
    res.setHeader('content-type', 'text/html; charset=utf-8');
    send(res, 200, html);
    return;
  }

  const postMatch = url.pathname.match(/^\/blog\/([^/]+)\/?$/);
  if (postMatch) {
    const html = await renderPost(postMatch[1]);
    if (!html) {
      send(res, 404, 'Not Found');
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    send(res, 200, html);
    return;
  }

  send(res, 404, 'Not Found');
});

const server = createServer(handler);
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
