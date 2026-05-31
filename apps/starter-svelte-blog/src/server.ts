/**
 * Svelte 5 standalone SSR server — Express + Vite + LaikaCMS without SvelteKit.
 *
 * This starter reveals what SvelteKit abstracts away:
 *
 *   1. Svelte files need compilation. In dev mode, vite.ssrLoadModule() compiles
 *      .svelte → server-side JS on demand. In production, vite build --ssr
 *      compiles to dist/server/.
 *
 *   2. render() from svelte/server returns { html, head }. The `head` contains
 *      <svelte:head> content. You must splice it into the HTML template yourself.
 *      SvelteKit handles this automatically; here it's explicit.
 *
 *   3. There is no hydration in this starter (renderToStaticMarkup equivalent).
 *      For client-side interactivity, use `mount()` from 'svelte' on the client
 *      and pass server-fetched data via a <script type="application/json"> tag.
 *
 * Doc gap found: The vite.ssrLoadModule() API is not in LaikaCMS docs — because
 * it's Vite-specific, not LaikaCMS-specific. But noting here that laika.ts must
 * be imported OUTSIDE of vite.ssrLoadModule() to preserve the module singleton.
 * If laika were imported inside entry-server.ts (and thus inside ssrLoadModule),
 * each request would create a new EmbeddedLaika instance and multiple filesystem
 * watchers. The solution: pass content as props from the server, keeping the
 * laika singleton in the Express process.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import express from 'express';
import { collectStream, runTask } from 'laikacms/compat';
import type { ViteDevServer } from 'vite';

import type { Post, PostSummary } from './entry-server.js';
import { laika } from './lib/laika.js';

const isDev = process.env['NODE_ENV'] !== 'production';
const PORT = Number(process.env['PORT'] ?? 3000);

// Load the HTML template once.
const templateHtml = readFileSync(
  isDev ? path.resolve(process.cwd(), 'index.html') : path.resolve(process.cwd(), 'dist/index.html'),
  'utf-8',
);

/** Splice rendered { html, head } + title into the HTML template. */
function buildPage(rendered: { html: string, head: string }, title: string): string {
  return templateHtml
    .replace('<!--ssr-title-->', title)
    .replace('<!--ssr-head-->', rendered.head)
    .replace('<!--ssr-body-->', rendered.html);
}

const app = express();

// Static files
app.use('/admin', express.static('public/admin'));
app.use('/uploads', express.static('public/uploads'));

// Decap JSON:API proxy — converts Express IncomingMessage → WHATWG Request.
app.all('/api/decap/*path', async (req, res) => {
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

// Set up Vite dev server middleware (dev mode only).
let vite: ViteDevServer | null = null;
if (isDev) {
  const { createServer } = await import('vite');
  vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });
  app.use(vite.middlewares);
}

/** Load the SSR entry module (dev: via Vite HMR; prod: pre-built dist). */
async function loadEntry() {
  if (isDev && vite) {
    // vite.ssrLoadModule transforms .svelte files using @sveltejs/vite-plugin-svelte
    // with generate:'server' so render() from svelte/server works correctly.
    return vite.ssrLoadModule('/src/entry-server.ts') as Promise<typeof import('./entry-server.js')>;
  }
  // Production: import the pre-built SSR bundle from dist/server/entry-server.js
  // (string variable so TS doesn't try to resolve the dist path at typecheck).
  const distEntry = '../dist/server/entry-server.js';
  return import(distEntry) as Promise<typeof import('./entry-server.js')>;
}

/** Load published posts from LaikaCMS. */
async function loadPosts(): Promise<PostSummary[]> {
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );
  return records
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    })
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      title: undefined,
      updatedAt: r.updatedAt ?? null,
    }));
}

app.get('/', async (_req, res) => {
  try {
    const [posts, { renderBlogPage }] = await Promise.all([loadPosts(), loadEntry()]);
    const rendered = renderBlogPage(posts);
    res.setHeader('content-type', 'text/html; charset=utf-8').send(buildPage(rendered, 'My Blog'));
  } catch (err) {
    if (isDev && vite) vite.ssrFixStacktrace(err as Error);
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/blog/:slug', async (req, res) => {
  const { slug } = req.params;
  let post: Post;
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    post = doc.content as Post;
  } catch {
    const { renderNotFoundPage } = await loadEntry();
    const rendered = renderNotFoundPage();
    res.status(404).setHeader('content-type', 'text/html; charset=utf-8').send(buildPage(rendered, 'Not Found'));
    return;
  }
  try {
    const { renderPostPage } = await loadEntry();
    const rendered = renderPostPage(slug, post);
    res.setHeader('content-type', 'text/html; charset=utf-8').send(buildPage(rendered, post.title ?? slug));
  } catch (err) {
    if (isDev && vite) vite.ssrFixStacktrace(err as Error);
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.use(async (_req, res) => {
  const { renderNotFoundPage } = await loadEntry();
  const rendered = renderNotFoundPage();
  res.status(404).setHeader('content-type', 'text/html; charset=utf-8').send(buildPage(rendered, 'Not Found'));
});

app.listen(PORT, () => {
  console.log(`\nSvelte blog running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
  if (isDev) {
    console.log('\n  Vite handles .svelte compilation via ssrLoadModule.');
    console.log('  Edit components in src/components/ and refresh to see changes.\n');
  }
});
