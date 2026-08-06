/**
 * Bare Vite SSR server — Express + React + LaikaCMS without a meta-framework.
 *
 * Doc gap: Meta-frameworks like Next.js and TanStack Start abstract these
 * steps, but under the hood they all do something similar:
 *   1. Fetch data server-side (here: directly from laika.documents)
 *   2. Render React to a string with renderToStaticMarkup / renderToString
 *   3. Send the HTML with '<!doctype html>' prepended
 *   4. Proxy the Decap API through a catch-all route
 *
 * This starter uses renderToStaticMarkup (no hydration) for simplicity.
 * For a hydrated SPA, swap to renderToString + client hydrateRoot, and
 * pass server-fetched data to the client via a <script> tag.
 */
import path from 'node:path';

import express from 'express';
import { collectStream, runTask } from 'laikacms/compat';
import { renderToStaticMarkup } from 'react-dom/server';

import { laika } from './laika.js';
import { HomePage, NotFoundPage, PostPage } from './pages.js';

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

const app = express();

app.use(express.static(path.resolve(process.cwd(), 'public')));

app.all('/api/decap/*path', async (req, res) => {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.originalUrl ?? req.url, `http://${host}`);
  const rawBody: Buffer[] = [];
  for await (const chunk of req) {
    rawBody.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  const body = Buffer.concat(rawBody);

  const webReq = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: body.byteLength > 0 && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
    ...(body.byteLength > 0 ? { duplex: 'half' } : {}),
  } as RequestInit);

  const webRes = await laika.fetch(webReq);
  res.status(webRes.status);
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
  });
  res.end(Buffer.from(await webRes.arrayBuffer()));
});

app.get('/', async (_req, res) => {
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

  const html = `<!doctype html>${renderToStaticMarkup(<HomePage posts={posts} />)}`;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/blog/:slug', async (req, res) => {
  const { slug } = req.params;
  let post: PostContent;
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    post = doc.content as PostContent;
  } catch {
    res.status(404);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>${renderToStaticMarkup(<NotFoundPage />)}`);
    return;
  }
  const html = `<!doctype html>${renderToStaticMarkup(<PostPage slug={slug} post={post} />)}`;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(html);
});

app.use((_req, res) => {
  res.status(404);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>${renderToStaticMarkup(<NotFoundPage />)}`);
});

const PORT = process.env['PORT'] ?? 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
