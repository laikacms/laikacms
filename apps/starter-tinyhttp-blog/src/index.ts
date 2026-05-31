import type { IncomingMessage, ServerResponse } from 'node:http';

import { App } from '@tinyhttp/app';
import { collectStream, runTask } from 'laikacms/compat';
import sirv from 'sirv';

import { laika } from './laika.js';

const app = new App();

/**
 * Bridge a tinyhttp request to a Web API Request so laika.fetch can handle it.
 *
 * tinyhttp uses Node.js IncomingMessage (a Readable stream), while laika.fetch
 * expects the WHATWG Fetch Request. This adapter reads the raw body buffer and
 * constructs a proper Request object.
 *
 * Doc gap: laika.fetch takes a Web API Request, not Node's IncomingMessage.
 * Frameworks that use Web API natively (Hono, Remix, Astro, Nuxt via h3) need
 * no adapter. tinyhttp and plain http.Server need one — document this pattern.
 */
async function toLaikaRequest(req: IncomingMessage & { originalUrl?: string }): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.originalUrl ?? req.url ?? '/', `http://${host}`);

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
    method: req.method,
    headers: req.headers as Record<string, string>,
    body,
  });
}

async function sendLaikaResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, name) => {
    // transfer-encoding is managed by Node's http module
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
  });
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

// Decap JSON:API — proxy all /api/decap/* requests to laika.
app.use('/api/decap', async (req, res, next) => {
  try {
    const webRes = await laika.fetch(await toLaikaRequest(req));
    await sendLaikaResponse(webRes, res);
  } catch (err) {
    next(err);
  }
});

// Blog index.
app.get('/', async (_req, res, next) => {
  try {
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
        const date = post.updatedAt ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>` : '';
        return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
      })
      .join('\n      ');

    const body = posts.length === 0
      ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

    res.send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title></head>
<body>
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

// Blog post.
app.get('/blog/:slug', async (req, res, _next) => {
  try {
    const { slug } = req.params;
    const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const { title, date, description, body } = post.content as {
      title?: string,
      date?: string,
      description?: string,
      body?: string,
    };

    res.send(`<!doctype html>
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
});

// Static files from public/ — serves /admin/index.html, /admin/bundle.js, /uploads/*, etc.
app.use(sirv('public', { dev: true }));

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`tinyhttp blog running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
});
