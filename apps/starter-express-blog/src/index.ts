import { createServer } from 'node:http';

import express from 'express';
import type { Request as ExpressReq, Response as ExpressRes } from 'express';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

const app = express();

/**
 * Bridge an Express request to a Web API Request so laika.fetch can handle it.
 *
 * Express uses Node.js IncomingMessage (a Readable stream), while laika.fetch
 * expects the WHATWG Fetch Request. This adapter reads the raw body buffer and
 * constructs a proper Request object.
 *
 * Doc gap: laika.fetch takes a Web API Request, not Node's IncomingMessage.
 * Frameworks that use Web API natively (Hono, Remix, Astro, Nuxt via h3) need
 * no adapter. Express and plain http.Server need one — document this pattern.
 */
async function toLaikaRequest(req: ExpressReq): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.originalUrl, `http://${host}`);

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

async function sendLaikaResponse(webRes: Response, res: ExpressRes): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((value, name) => {
    // transfer-encoding is managed by Node's http module
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
  });
  res.send(Buffer.from(await webRes.arrayBuffer()));
}

// Decap JSON:API — proxy all /api/decap/* requests to laika.
app.all('/api/decap/*path', async (req, res, next) => {
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
    res.status(404).send('Not found');
  }
});

// Static files from public/ — serves /admin/index.html, /admin/bundle.js, /uploads/*, etc.
app.use(express.static('public'));

const PORT = Number(process.env.PORT ?? 3000);
createServer(app).listen(PORT, () => {
  console.log(`Express blog running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
});
