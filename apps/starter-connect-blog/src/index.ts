import * as http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import connect from 'connect';
import { collectStream, runTask } from 'laikacms/compat';

import { ADMIN_HTML, laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);
const app = connect();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  return new Promise<Buffer>(resolve => req.on('end', () => resolve(Buffer.concat(chunks))));
}

function htmlResponse(res: ServerResponse, status: number, body: string): void {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.byteLength,
  });
  res.end(buf);
}

// ── Decap JSON:API proxy ──────────────────────────────────────────────────────
// connect has no built-in body parser.  The IncomingMessage stream is still
// pristine when our middleware runs, so we can forward it directly.
// connect path prefix matching: mount at '/api/decap' trims that prefix from
// req.url, so req.url inside the handler is the sub-path (e.g. '/documents').
// We reconstruct the full URL from req.originalUrl (connect sets it).
app.use('/api/decap', async (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse) => {
  const body = await readBody(req);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  // connect sets req.originalUrl so the full path is available even inside a
  // prefix-mounted middleware (where req.url would be the sub-path).
  const fullPath = (req as { originalUrl?: string }).originalUrl ?? req.url ?? '/';
  const url = `http://${req.headers.host ?? `localhost:${PORT}`}${fullPath}`;

  const webReq = new Request(url, {
    method: req.method!,
    headers: req.headers as Record<string, string>,
    body: hasBody && body.length > 0 ? body : null,
  });

  const webRes = await laika.fetch(webReq);
  const responseBody = Buffer.from(await webRes.arrayBuffer());

  const headers: http.OutgoingHttpHeaders = {};
  webRes.headers.forEach((value: string, name: string) => {
    if (name.toLowerCase() !== 'transfer-encoding') headers[name] = value;
  });
  res.writeHead(webRes.status, headers);
  res.end(responseBody);
});

// ── Admin ─────────────────────────────────────────────────────────────────────
// connect has no path-parameter routing — match admin paths with startsWith.
app.use('/admin', (_req: IncomingMessage, res: ServerResponse) => {
  htmlResponse(res, 200, ADMIN_HTML);
});

// ── Blog ─────────────────────────────────────────────────────────────────────
// connect has no router.  Parse URL paths manually for GET routes.
app.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
  const url = req.url ?? '/';

  // ── Blog index ──
  if (url === '/' || url === '') {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    type RecordSummary = { type: string, key: string, updatedAt?: string };
    const posts = (records as RecordSummary[])
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => (b.updatedAt ?? b.key).localeCompare(a.updatedAt ?? a.key));

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

    return htmlResponse(
      res,
      200,
      `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title></head>
<body>
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`,
    );
  }

  // ── Blog post ──
  const postMatch = /^\/blog\/([^/?#]+)$/.exec(url);
  if (postMatch) {
    const slug = decodeURIComponent(postMatch[1]);
    let post;
    try {
      post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    } catch {
      return htmlResponse(res, 404, '<h1>404 Not Found</h1>');
    }

    const { title, date, description, body } = post.content as {
      title?: string,
      date?: string,
      description?: string,
      body?: string,
    };

    return htmlResponse(
      res,
      200,
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
    );
  }

  next();
});

// ── Start server ──────────────────────────────────────────────────────────────
http.createServer(app).listen(PORT, () => {
  console.log(`connect blog running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
});
