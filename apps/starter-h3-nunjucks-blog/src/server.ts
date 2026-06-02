/**
 * H3 + Nunjucks + remark Markdown rendering + LaikaCMS.
 *
 * Three things this starter shows that others don't:
 *
 *   1. H3's WHATWG-native bridge — toWebRequest(event) and sendWebResponse()
 *      make the Decap proxy a two-liner. H3 is the HTTP primitive beneath
 *      Nitro and Nuxt; using it directly shows what the build tooling hides.
 *
 *   2. Nunjucks with H3 — no special H3 plugin needed. Configure Nunjucks
 *      as a singleton, call nunjucks.render() in each handler, send the
 *      result as a plain text/html response via setResponseHeader + send.
 *
 *   3. H3 serveStatic — serves files from the filesystem via a getContents
 *      callback. Unlike Express's express.static or Fastify's @fastify/static,
 *      H3's serveStatic is a handler you call manually, giving fine-grained
 *      control over which paths get static serving.
 */
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

import {
  createApp,
  createRouter,
  defineEventHandler,
  getRouterParam,
  send,
  sendWebResponse,
  serveStatic,
  setResponseHeader,
  toNodeListener,
  toWebRequest,
} from 'h3';
import { collectStream, runTask } from 'laikacms/compat';
import nunjucks from 'nunjucks';

import { laika } from './laika.js';
import { renderMarkdown } from './md.js';

const PUBLIC_DIR = resolve(process.cwd(), 'public');
const VIEWS_DIR = resolve(process.cwd(), 'views');

// Configure Nunjucks as a module-level singleton.
// `autoescape: true` HTML-escapes all {{ }} output by default.
// The VIEWS_DIR environment controls where templates are loaded from.
const env = nunjucks.configure(VIEWS_DIR, {
  autoescape: true,
  watch: process.env['NODE_ENV'] !== 'production',
});

const app = createApp();
const router = createRouter();

// Decap JSON:API proxy.
// H3's toWebRequest(event) converts the H3 event to a WHATWG Request that
// laika.fetch accepts. sendWebResponse() writes the WHATWG Response back.
// This is the most concise proxy implementation across all framework starters.
router.use(
  '/api/decap/**',
  defineEventHandler(async event => {
    const request = toWebRequest(event);
    const response = await laika.fetch(request);
    return sendWebResponse(event, response);
  }),
);

// Blog index.
router.get(
  '/',
  defineEventHandler(async event => {
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

    const html = env.render('index.html', { title: 'My Blog', posts });
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
    return send(event, html);
  }),
);

// Blog post — renders Markdown body to safe HTML via remark pipeline.
router.get(
  '/blog/:slug',
  defineEventHandler(async event => {
    const slug = getRouterParam(event, 'slug');
    if (!slug) return sendWebResponse(event, new Response('Not found', { status: 404 }));

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
      const html = env.render('404.html', { title: 'Not found' });
      setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
      return sendWebResponse(
        event,
        new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      );
    }

    const html = env.render('post.html', { title, date, bodyHtml });
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
    return send(event, html);
  }),
);

// Static files — serve /admin/ and /uploads/ from public/ directory.
app.use(
  defineEventHandler(event => {
    const url = event.path ?? '/';
    if (url.startsWith('/api/')) return;

    return serveStatic(event, {
      getContents: path => {
        const filePath = join(PUBLIC_DIR, path);
        if (!existsSync(filePath)) return undefined;
        return createReadStream(filePath);
      },
      getMeta: path => {
        const filePath = join(PUBLIC_DIR, path);
        if (!existsSync(filePath)) return undefined;
        const ext = extname(path).slice(1);
        const mime: Record<string, string> = {
          html: 'text/html',
          js: 'application/javascript',
          css: 'text/css',
          png: 'image/png',
          jpg: 'image/jpeg',
          svg: 'image/svg+xml',
        };
        return { type: mime[ext] ?? 'application/octet-stream' };
      },
      indexNames: ['index.html'],
    });
  }),
);

app.use(router);

const port = Number(process.env['PORT'] ?? 3000);
createServer(toNodeListener(app)).listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
