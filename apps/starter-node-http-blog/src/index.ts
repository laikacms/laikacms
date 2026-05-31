import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';

import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

// ─── WHATWG Request / Response bridge ────────────────────────────────────────
//
// Node.js http.IncomingMessage is a Readable stream. laika.fetch expects a
// WHATWG Fetch API Request — a different interface entirely.
//
// For GET / HEAD we can pass body: undefined. For all other methods we need to
// drain the IncomingMessage stream into a Buffer first, then wrap it as an
// ArrayBuffer for the Request constructor.
//
// Doc gap: this is the minimum code needed to use laika.fetch from a raw
// Node.js server. Every Node.js framework adapter (Express, Fastify, Koa,
// NestJS) does some variant of this internally.
//

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);

  let body: ArrayBuffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) chunks.push(new Uint8Array(chunk as Buffer));
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    if (total > 0) {
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      body = merged.buffer;
    }
  }

  return new Request(url, {
    method: req.method ?? 'GET',
    headers: req.headers as Record<string, string>,
    body,
  });
}

async function sendWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value: string, name: string) => {
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
  });
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

// ─── Static file server ───────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const filePath = join(process.cwd(), 'public', pathname);
  try {
    const stat = statSync(filePath);
    const file = stat.isDirectory() ? `${filePath}/index.html` : filePath;
    const mime = MIME[extname(file)] ?? 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}

// ─── Request handler ──────────────────────────────────────────────────────────

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  try {
    // Decap JSON:API — delegate to laika.fetch.
    if (path.startsWith('/api/decap')) {
      const webReq = await toWebRequest(req);
      const webRes = await laika.fetch(webReq);
      await sendWebResponse(webRes, res);
      return;
    }

    // Blog index.
    if (path === '/' && method === 'GET') {
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

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title></head>
<body>
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`);
      return;
    }

    // Blog post — /blog/:slug
    const postMatch = path.match(/^\/blog\/([^/]+)$/);
    if (postMatch && method === 'GET') {
      const slug = postMatch[1];
      try {
        const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
        const { title, date, description, body } = post.content as {
          title?: string,
          date?: string,
          description?: string,
          body?: string,
        };

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html>
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
</html>`);
      } catch {
        res.statusCode = 404;
        res.end('Not found');
      }
      return;
    }

    // Static files — /admin/, /admin/bundle.js, /uploads/*, etc.
    if (serveStatic(path, res)) return;

    res.statusCode = 404;
    res.end('Not found');
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end('Internal server error');
  }
}

const PORT = Number(process.env.PORT ?? 3000);
createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
}).listen(PORT, () => {
  console.log(`Node.js blog running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
});
