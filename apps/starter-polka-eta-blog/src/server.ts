/**
 * Polka + Eta + remark Markdown rendering + LaikaCMS.
 *
 * Three things this starter shows that others don't:
 *
 *   1. Eta template engine — TypeScript-native, ESM-first, auto-escaping.
 *      Eta uses EJS-compatible syntax (<% %>, <%= %>, <%- %>) but is written
 *      in TypeScript from scratch, has zero runtime dependencies, and is
 *      ~4x faster than EJS. <%- value %> outputs unescaped HTML for
 *      pre-rendered Markdown (vs <%= %> which escapes HTML entities).
 *
 *   2. Polka server — tiny Express-compatible router (~4KB vs Express ~200KB).
 *      Used internally by SvelteKit's Vite dev server. Express middleware
 *      works with Polka; no API changes needed vs Express starters.
 *
 *   3. Eta layout partials — `@include('layout/head', { title })` injects
 *      partials into the layout. Unlike Nunjucks/Pug extends/block, Eta
 *      uses function-call-like syntax to compose templates.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import { Eta } from 'eta';
import { collectStream, runTask } from 'laikacms/compat';
import polka from 'polka';
import sirv from 'sirv';

import { laika } from './laika.js';
import { renderMarkdown } from './md.js';

const VIEWS_DIR = resolve(process.cwd(), 'views');

// Configure Eta to load templates from views/ directory.
// `autoEscape: true` HTML-escapes all <%= %> output; use <%- %> for raw HTML.
const eta = new Eta({ views: VIEWS_DIR, autoEscape: true });

// Bridge Node.js IncomingMessage → WHATWG Request for laika.fetch.
async function toLaikaRequest(req: IncomingMessage): Promise<Request> {
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
      body = merged.buffer as ArrayBuffer;
    }
  }

  return new Request(url, {
    method: req.method ?? 'GET',
    headers: req.headers as Record<string, string>,
    body,
    ...(body ? { duplex: 'half' } : {}),
  } as RequestInit);
}

async function sendLaikaResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
  });
  if (webRes.body) {
    Readable.fromWeb(webRes.body as import('stream/web').ReadableStream).pipe(res);
  } else {
    res.end();
  }
}

const app = polka();

// Decap JSON:API proxy.
app.use('/api/decap', async (req, res) => {
  const webReq = await toLaikaRequest(req);
  const webRes = await laika.fetch(webReq);
  await sendLaikaResponse(webRes, res);
});

// Blog index.
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
      date: r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : null,
    }));

  const html = await eta.renderAsync('./index', { title: 'My Blog', posts });
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
});

// Blog post — renders Markdown body to safe HTML via remark pipeline.
app.get('/blog/:slug', async (req, res) => {
  const { slug } = req.params as { slug: string };

  let title: string;
  let bodyHtml: string;
  let date: string | null;

  try {
    const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const content = post.content as { title?: string, date?: string, body?: string };

    title = content.title ?? slug;
    date = content.date ? new Date(content.date).toLocaleDateString() : null;
    bodyHtml = await renderMarkdown(content.body ?? '');
  } catch {
    res.statusCode = 404;
    const html = await eta.renderAsync('./404', { title: 'Not found' });
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }

  const html = await eta.renderAsync('./post', { title, date, bodyHtml });
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
});

// Static files from public/ — admin UI, uploads.
app.use(sirv('public', { dev: process.env['NODE_ENV'] !== 'production' }));

const port = Number(process.env['PORT'] ?? 3000);
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
