/**
 * Express + EJS SSR blog — traditional template engine approach.
 *
 * No components, no JSX, no build step for templates. EJS embeds JS expressions
 * directly in HTML files: <%= variable %>, <% if (condition) { %> etc.
 *
 * The Express request body bridge for laika.fetch:
 *   1. Express parses the raw body stream before any middleware sees it
 *   2. We reconstruct a WHATWG Request from the Express req object
 *   3. laika.fetch returns a WHATWG Response which we pipe back to res
 */
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import express from 'express';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

const app = express();

app.set('view engine', 'ejs');
app.set('views', resolve(process.cwd(), 'views'));

// Serve /admin/bundle.js and other static assets.
app.use(express.static('public'));

// Preserve the raw body before Express body-parser can consume the stream.
// laika.fetch needs the raw bytes to reconstruct a WHATWG Request.
app.use(
  '/api/decap',
  express.raw({ type: '*/*', limit: '10mb' }),
  async (req, res) => {
    const host = req.headers.host ?? 'localhost';
    const proto = req.protocol ?? 'http';
    const url = `${proto}://${host}${req.originalUrl}`;

    const rawBody = req.body instanceof Buffer && req.body.byteLength > 0
      ? req.body
      : undefined;

    const webReq = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: rawBody,
      ...(rawBody ? { duplex: 'half' } : {}),
    } as RequestInit);

    const webRes = await laika.fetch(webReq);

    res.status(webRes.status);
    webRes.headers.forEach((v, k) => {
      // transfer-encoding: chunked conflicts with Express's own response buffering
      if (k.toLowerCase() !== 'transfer-encoding') res.setHeader(k, v);
    });

    if (webRes.body) {
      Readable.fromWeb(webRes.body as import('stream/web').ReadableStream).pipe(res);
    } else {
      res.end();
    }
  },
);

// Blog index — list published posts.
app.get('/', async (_req, res) => {
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
    })
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? undefined,
    }));

  res.render('index', { posts });
});

// Individual blog post.
app.get('/blog/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const post = doc.content as { title?: string, date?: string, description?: string, body?: string };
    res.render('post', { slug, post });
  } catch {
    res.status(404).render('404', {});
  }
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Express EJS blog running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
});
