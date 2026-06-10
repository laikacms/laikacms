import { collectStream, runTask } from 'laikacms/compat';
import restify from 'restify';

import { ADMIN_HTML, laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);

const server = restify.createServer({ name: 'laika-blog' });

// ── Decap JSON:API proxy ──────────────────────────────────────────────────────
// Restify's bodyParser would consume the stream before we can forward it.
// By registering NO global bodyParser, route handlers receive a fresh
// IncomingMessage stream.  We read it manually here into a Buffer.
//
// Restify's res.send() runs the response through its formatter pipeline
// (which can re-encode JSON, etc.) so we write directly to the underlying
// ServerResponse via res.socket for binary pass-through — but the simpler
// approach is res.header() + res.sendRaw() which bypasses formatters.
async function decapProxy(req: restify.Request, res: restify.Response) {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  await new Promise<void>(resolve => req.on('end', resolve));
  const body = Buffer.concat(chunks);

  const host = req.headers.host ?? `localhost:${PORT}`;
  // req.url is the path without mount point rewriting — the full path.
  const url = `http://${host}${req.url}`;

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const webReq = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: hasBody && body.length > 0 ? body : null,
  });

  const webRes = await laika.fetch(webReq);

  res.status(webRes.status);
  webRes.headers.forEach((value: string, name: string) => {
    if (name.toLowerCase() !== 'transfer-encoding') res.header(name, value);
  });
  // sendRaw bypasses Restify's content-type formatters so binary bodies
  // (JSON, multipart responses) arrive at the browser unchanged.
  res.sendRaw(webRes.status, Buffer.from(await webRes.arrayBuffer()));
}

// Register the proxy for every HTTP method Decap uses.
const DECAP_PATH = '/api/decap/*';
server.get(DECAP_PATH, decapProxy);
server.post(DECAP_PATH, decapProxy);
server.put(DECAP_PATH, decapProxy);
server.patch(DECAP_PATH, decapProxy);
server.del(DECAP_PATH, decapProxy);
server.head(DECAP_PATH, decapProxy);
server.opts(DECAP_PATH, decapProxy);

// ── Admin ─────────────────────────────────────────────────────────────────────
server.get('/admin', (_req, res) => {
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.sendRaw(200, ADMIN_HTML);
});
server.get('/admin/', (_req, res) => {
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.sendRaw(200, ADMIN_HTML);
});

// ── Blog index ────────────────────────────────────────────────────────────────
server.get('/', async (_req, res) => {
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

  res.header('Content-Type', 'text/html; charset=utf-8');
  res.sendRaw(
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
});

// ── Blog post ─────────────────────────────────────────────────────────────────
server.get('/blog/:slug', async (req, res) => {
  const { slug } = req.params as { slug: string };

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    res.send(404, 'Post not found');
    return;
  }

  const { title, date, description, body } = post.content as {
    title?: string,
    date?: string,
    description?: string,
    body?: string,
  };

  res.header('Content-Type', 'text/html; charset=utf-8');
  res.sendRaw(
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
});

server.listen(PORT, () => {
  console.log(`Restify blog running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
});
