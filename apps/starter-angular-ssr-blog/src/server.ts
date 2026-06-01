/**
 * Angular SSR + Express + LaikaCMS server.
 *
 * Architecture (what Analog/Nitro abstracts):
 *   - In dev: Vite createServer() + ssrLoadModule() compile .ts files on demand,
 *     reloading when they change. Zone.js + Angular template compilation happen
 *     inside the module scope of entry-server.ts.
 *   - In prod: ssrLoadModule() is replaced by a pre-built dist/server bundle.
 *
 * LaikaCMS integration:
 *   - createEmbeddedLaika singleton holds the filesystem storage repository.
 *   - /api/decap/* is proxied to laika.fetch() via the Express↔WHATWG adapter.
 *   - /api/posts and /api/posts/:slug expose read endpoints for Angular components.
 *   - Angular SSR renders the app into the index.html shell for each navigation.
 */
import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import express from 'express';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ViteDevServer } from 'vite';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env['PORT'] ?? 3000);
const isDev = process.env['NODE_ENV'] !== 'production';

const decapConfig = minimalBlogConfig();

const laika = createEmbeddedLaika({
  contentDir: resolve(ROOT, 'content'),
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const app = express();

app.get('/admin', (_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(decapAdminHtml({ decapConfig }));
});

// LaikaCMS JSON:API — WHATWG fetch adapter (no body parser before this).
app.all('/api/decap/*', async (req, res) => {
  const host = req.headers['host'] ?? 'localhost';
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
  webRes.headers.forEach((val, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, val);
  });
  res.end(Buffer.from(await webRes.arrayBuffer()));
});

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

// Posts API consumed by Angular's HttpClient (SSR + client).
app.get('/api/posts', async (_req, res) => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  const posts = items
    .filter(doc => doc.type === 'published')
    .map(doc => {
      const content = doc.content as PostContent;
      const slug = doc.key.replace(/^posts\//, '').replace(/\.md$/, '');
      return { slug, title: content.title ?? slug, date: content.date ?? '', description: content.description ?? '' };
    });
  res.json(posts);
});

app.get('/api/posts/:slug', async (req, res) => {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${req.params['slug']}`));
    const content = doc.content as PostContent;
    res.json({ slug: req.params['slug'], ...content });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: 'Not found' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Vite dev middleware (dev mode only).
let vite: ViteDevServer | null = null;
if (isDev) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(resolve(ROOT, 'dist')));
}

// Angular SSR render function loader.
async function loadRender(): Promise<(url: string, document: string) => Promise<string>> {
  if (isDev && vite) {
    const mod = await vite.ssrLoadModule('/src/entry-server.ts');
    return (mod as { render: (url: string, document: string) => Promise<string> }).render;
  }
  const distEntry = resolve(ROOT, 'dist/server/entry-server.js');
  const mod = await import(distEntry);
  return (mod as { render: (url: string, document: string) => Promise<string> }).render;
}

// Read the HTML template.
function getTemplate(): string {
  const p = isDev ? resolve(ROOT, 'index.html') : resolve(ROOT, 'dist/index.html');
  return readFileSync(p, 'utf-8');
}

// Angular SSR catch-all.
app.get('*', async (req, res, next) => {
  try {
    const render = await loadRender();
    const template = isDev && vite
      ? await vite.transformIndexHtml(req.url, getTemplate())
      : getTemplate();
    const url = `http://localhost:${PORT}${req.url}`;
    const html = await render(url, template);
    res.setHeader('content-type', 'text/html; charset=utf-8').send(html);
  } catch (err) {
    if (isDev && vite) vite.ssrFixStacktrace(err as Error);
    next(err);
  }
});

const server = createHttpServer(app);
server.listen(PORT, () => {
  console.log(`Angular SSR blog:  http://localhost:${PORT}`);
  console.log(`Decap admin:       http://localhost:${PORT}/admin`);
});
