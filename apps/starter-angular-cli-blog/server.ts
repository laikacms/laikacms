import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import type { Request as ExpressReq, Response as ExpressRes } from 'express';
import express from 'express';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './src/lib/laika.js';

/**
 * Bridge an Express 5 request to a Web API Request for laika.fetch.
 *
 * Doc gap: `laika.fetch` expects the WHATWG Fetch API `Request` object.
 * Express provides an `IncomingMessage`-derived object with `req.body` (when
 * express.json() runs) or a raw stream. To bridge, read the body buffer and
 * reconstruct a standard `Request`. See the same adapter in starter-express-blog.
 *
 * Express 5 exposes `req.body` as the parsed body for JSON, but for the raw
 * binary stream (multipart, arbitrary blobs) we read from the stream directly.
 * Since Decap traffic is JSON, `express.json()` middleware handles this.
 */
async function toLaikaRequest(req: ExpressReq): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.originalUrl, `http://${host}`);

  let body: BodyInit | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body !== undefined) {
      body = JSON.stringify(req.body);
    } else {
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
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
  });
  res.send(Buffer.from(await webRes.arrayBuffer()));
}

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

app.use(express.json());

/**
 * API: list posts — returns an array of post summaries.
 *
 * Angular components call GET /api/posts from the browser (and during SSR, the
 * Angular Universal engine makes an HTTP request back to this same Express
 * server — the reason `withFetch()` is required in the app config).
 */
app.get('/api/posts', async (_req, res, next) => {
  try {
    const { items } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );
    type RecordSummary = { type: string, key: string, updatedAt?: string };
    const posts = (items as RecordSummary[])
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });
    res.json(posts);
  } catch (err) {
    next(err);
  }
});

/** API: single post. */
app.get('/api/posts/:slug', async (req, res, _next) => {
  try {
    const { slug } = req.params;
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    res.json({ slug, content: doc.content });
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

/** Decap JSON:API proxy. */
app.all('/api/decap/*path', async (req, res, next) => {
  try {
    const webRes = await laika.fetch(await toLaikaRequest(req));
    await sendLaikaResponse(webRes, res);
  } catch (err) {
    next(err);
  }
});

/** Static browser bundle produced by `ng build`. */
app.use(express.static(browserDistFolder, { maxAge: '1y', index: false }));

/**
 * Angular SSR handler — falls through after static files.
 *
 * `createNodeRequestHandler` wraps `angularApp.handle()` into a standard
 * Express request handler. `writeResponseToNodeResponse` converts the Angular
 * Web API Response back to Node's ServerResponse.
 */
app.use(
  '/**',
  createNodeRequestHandler(async (req, res, next) => {
    try {
      const webRes = await angularApp.handle(req);
      if (webRes) {
        writeResponseToNodeResponse(webRes, res);
      } else {
        next();
      }
    } catch (err) {
      next(err);
    }
  }),
);

if (isMainModule(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => {
    console.log(`Angular SSR blog at http://localhost:${port}`);
    console.log(`  Blog:  http://localhost:${port}/`);
    console.log(`  Admin: http://localhost:${port}/admin`);
  });
}

export default app;
