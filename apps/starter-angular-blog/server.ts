/**
 * Angular SSR Express server — LaikaCMS integration.
 *
 * Route priority (first match wins):
 *   1. POST /api/decap/*  — Decap JSON:API (Node IncomingMessage → WHATWG bridge)
 *   2. GET  /api/posts    — blog list   (laika.documents, no extra HTTP hop)
 *   3. GET  /api/posts/:slug — single post
 *   4. GET  /admin        — Decap CMS admin shell via decapAdminHtml()
 *   5. GET  **            — Angular browser build static assets
 *   6. GET  **            — Angular SSR (CommonEngine)
 *
 * SERVER_ORIGIN is injected into each SSR render so absoluteUrlInterceptor
 * can convert relative HttpClient URLs to absolute during server rendering.
 */
import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express from 'express';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';
import { collectStream, runTask } from 'laikacms/compat';

import { SERVER_ORIGIN } from './src/app/tokens';
import { laika } from './src/laika';
import bootstrap from './src/main.server';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

// Render once at startup — the HTML is static (config baked in).
const ADMIN_HTML = decapAdminHtml();

export function app(): express.Express {
  const server = express();
  const commonEngine = new CommonEngine();

  server.set('view engine', 'html');
  server.set('views', browserDistFolder);

  // 1. Decap JSON:API
  //
  // Express delivers an IncomingMessage; laika.fetch expects a WHATWG Request.
  // The bridge pattern from docs/decap-integration.md § Express bridge:
  //   - Collect the body from the Node.js stream.
  //   - Construct a WHATWG Request with the exact ArrayBuffer slice (TS6 requirement).
  //   - Pipe the WHATWG Response body back through the Node.js response.
  server.all('/api/decap/*', async (req, res) => {
    const url = `${req.protocol}://${req.headers['host'] ?? 'localhost'}${req.originalUrl}`;

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const buf = chunks.length ? Buffer.concat(chunks) : null;

    const hasBody = buf && buf.byteLength > 0 && req.method !== 'GET' && req.method !== 'HEAD';
    const webReq = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: hasBody
        ? (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
        : null,
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit);

    const webRes = await laika.fetch(webReq);
    res.status(webRes.status);
    webRes.headers.forEach((v, k) => res.setHeader(k, v));
    if (webRes.body) {
      Readable.fromWeb(webRes.body as import('stream/web').ReadableStream).pipe(res);
    } else {
      res.end();
    }
  });

  // 2. Blog list API — Angular HttpClient reads this during SSR + client navigation.
  server.get('/api/posts', async (_req, res) => {
    try {
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
        })
        .map(r => ({
          slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
          updatedAt: r.updatedAt ?? null,
        }));
      res.json(posts);
    } catch {
      res.status(500).json({ error: 'Failed to load posts' });
    }
  });

  // 3. Single post API
  server.get('/api/posts/:slug', async (req, res) => {
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${req.params['slug']}`));
      res.json({ slug: req.params['slug'], ...doc.content });
    } catch {
      res.status(404).json({ error: 'Not found' });
    }
  });

  // 4. Decap CMS admin — served before Angular catches /** routes.
  //    decapAdminHtml() returns a full <html> document with Decap loaded from CDN
  //    and the laika backend registered. No esbuild step needed.
  server.get('/admin', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(ADMIN_HTML);
  });

  // 5. Static files from the Angular browser build.
  server.get(
    '**',
    express.static(browserDistFolder, {
      maxAge: '1y',
      index: 'index.html',
      redirect: false,
    }),
  );

  // 6. Angular SSR — all remaining GET requests.
  server.get('**', (req, res, next) => {
    const { protocol, originalUrl, baseUrl, headers } = req;
    const serverOrigin = `${protocol}://${headers['host'] ?? 'localhost'}`;

    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: `${protocol}://${headers['host']}${originalUrl}`,
        publicPath: browserDistFolder,
        providers: [
          { provide: APP_BASE_HREF, useValue: baseUrl },
          // absoluteUrlInterceptor reads SERVER_ORIGIN during SSR to convert
          // relative /api/posts URLs to http://localhost:PORT/api/posts.
          { provide: SERVER_ORIGIN, useValue: serverOrigin },
        ],
      })
      .then(html => res.send(html))
      .catch(err => next(err));
  });

  return server;
}

function run(): void {
  const port = Number(process.env['PORT'] ?? 3000);
  const server = app();
  server.listen(port, () => {
    console.log(`Angular blog running at http://localhost:${port}`);
    console.log(`  Blog:  http://localhost:${port}/`);
    console.log(`  Admin: http://localhost:${port}/admin`);
  });
}

run();
