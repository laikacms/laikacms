/**
 * Bare Node.js HTTP server — no framework, no dependencies beyond LaikaCMS.
 *
 * This is the reference implementation showing exactly what every framework
 * adapter must do to integrate laika.fetch():
 *
 *   1. Reconstruct a full URL from the host header + req.url.
 *   2. Collect the raw body from the IncomingMessage stream.
 *   3. Build a WHATWG Request with method, headers, and optional body.
 *   4. Call laika.fetch(webReq) and pipe the WHATWG Response back to
 *      the ServerResponse.
 *
 * For static files we use node:fs.createReadStream — no middleware needed.
 */
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

const PUBLIC_DIR = resolve(process.cwd(), 'public');
const PORT = process.env['PORT'] ?? 3000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

function htmlPage(body: string, title = 'Blog'): Buffer {
  return Buffer.from(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`,
  );
}

function sendHtml(res: ServerResponse, buf: Buffer, status = 200): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.byteLength });
  res.end(buf);
}

async function collectBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const filePath = resolve(PUBLIC_DIR, pathname.slice(1));
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  if (!existsSync(filePath)) return false;

  const ext = extname(filePath);
  const contentType = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': contentType });
  await pipeline(createReadStream(filePath), res);
  return true;
}

const server = createServer(async (req, res) => {
  try {
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

    if (pathname.startsWith('/api/decap')) {
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const rawBody = await collectBody(req);
      let body: ArrayBuffer | undefined;
      if (rawBody.byteLength > 0 && method !== 'GET' && method !== 'HEAD') {
        body = rawBody.buffer.slice(rawBody.byteOffset, rawBody.byteOffset + rawBody.byteLength) as ArrayBuffer;
      }
      const webReq = new Request(url.toString(), {
        method,
        headers: req.headers as Record<string, string>,
        body,
        ...(body ? { duplex: 'half' } : {}),
      } as RequestInit);
      const webRes = await laika.fetch(webReq);
      res.writeHead(
        webRes.status,
        Object.fromEntries(
          [...webRes.headers.entries()].filter(([k]) => k.toLowerCase() !== 'transfer-encoding'),
        ),
      );
      res.end(Buffer.from(await webRes.arrayBuffer()));
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      const { items } = await collectStream(
        laika.documents.listRecordSummaries({
          pagination: { page: 1, perPage: 100 },
          folder: 'posts',
          depth: 1,
          type: 'published',
        }),
      );
      const posts = items
        .filter(r => r.type === 'published-summary')
        .sort((a, b) => {
          if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
          return b.key.localeCompare(a.key);
        });
      const slug = (key: string) => key.replace(/^posts\//, '').replace(/\.md$/, '');
      const bodyStr = posts.length === 0
        ? '<h1>Blog</h1><p>No posts yet. <a href="/admin">Open the CMS</a></p>'
        : `<h1>Blog</h1><ul>${
          posts.map(p => `<li><a href="/blog/${slug(p.key)}">${slug(p.key)}</a></li>`).join('')
        }</ul>`;
      sendHtml(res, htmlPage(`${bodyStr}<p><a href="/admin">Edit in CMS →</a></p>`));
      return;
    }

    const postMatch = /^\/blog\/([^/]+)$/.exec(pathname);
    if (postMatch) {
      const postSlug = postMatch[1]!;
      let post: PostContent;
      try {
        const doc = await runTask(laika.documents.getDocument(`posts/${postSlug}`));
        post = doc.content as PostContent;
      } catch {
        sendHtml(res, htmlPage('<p>Post not found. <a href="/">← Back</a></p>', '404'), 404);
        return;
      }
      const bodyStr = `
        <article>
          <h1>${post.title ?? postSlug}</h1>
          ${post.date ? `<time>${new Date(post.date).toLocaleDateString()}</time>` : ''}
          ${post.description ? `<p><em>${post.description}</em></p>` : ''}
          <pre style="white-space:pre-wrap;font-family:inherit">${post.body ?? ''}</pre>
        </article>
        <p><a href="/">← Back</a></p>`;
      sendHtml(res, htmlPage(bodyStr, post.title ?? postSlug));
      return;
    }

    if (await serveStatic(pathname, res)) return;

    const notFound = htmlPage('<p>Not found. <a href="/">← Back</a></p>', '404');
    sendHtml(res, notFound, 404);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
