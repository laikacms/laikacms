/**
 * Feathers.js v5 + LaikaCMS blog server.
 *
 * Architecture (API-first / headless CMS pattern):
 *   - Feathers REST service at /posts exposes LaikaCMS content as a typed API
 *   - /api/decap/* proxies to laika.fetch for the Decap CMS editor
 *   - /admin/* serves the static Decap admin UI
 *   - / serves a static blog page that fetches /posts JSON client-side
 *
 * Unlike SSR starters (Next.js, SvelteKit...), content is fetched by the
 * browser after page load. This is the "headless CMS + SPA" pattern where
 * the backend is a pure JSON API and the frontend is a static HTML file.
 *
 * Feathers REST transport is configured via rest() from @feathersjs/express.
 * The service class (PostsService) implements find() and get() using
 * laika.documents.* via laikacms/compat — the same API as all other starters.
 */
import path from 'node:path';

// @feathersjs/express is CJS: module.exports = Object.assign(feathersExpress, exports).
// TS's NodeNext + ESM-default-import sees the namespace, not the callable function,
// so we type the import directly.
import type { Application as FeathersApplication } from '@feathersjs/feathers';

import expressNs from '@feathersjs/express';
import { feathers } from '@feathersjs/feathers';

import { laika } from './lib/laika.js';
import { PostsService } from './services/posts.service.js';

interface FeathersExpressApp extends FeathersApplication {
  // express middleware surface used here
  use(...args: unknown[]): this;
  configure(fn: unknown): this;
  all(path: string, handler: (req: ExpressLikeRequest, res: ExpressLikeResponse) => unknown): this;
  listen(port: number, cb?: () => void): unknown;
}
interface ExpressLikeRequest extends AsyncIterable<Buffer | Uint8Array> {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  originalUrl?: string;
  url: string;
}
interface ExpressLikeResponse {
  status(code: number): this;
  setHeader(name: string, value: string): this;
  end(chunk?: Buffer): this;
}

const express = expressNs as typeof expressNs & ((app: FeathersApplication) => FeathersExpressApp);

const PORT = Number(process.env['PORT'] ?? 3000);

const app = express(feathers());

// Standard JSON body parsing and REST transport
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.configure(express.rest());

// Register the LaikaCMS-backed posts service — accessible at GET /posts and GET /posts/:id
app.use('posts', new PostsService());

// Decap JSON:API proxy — converts Express IncomingMessage → WHATWG Request
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

// Static files: admin UI + uploads
app.use(express.static(path.resolve(process.cwd(), 'public')));

// Error handler — Feathers formats errors as JSON automatically for service routes
app.use(express.errorHandler());

app.listen(PORT, () => {
  console.log(`\nFeathers blog running at http://localhost:${PORT}`);
  console.log(`  Blog:       http://localhost:${PORT}/`);
  console.log(`  Posts API:  http://localhost:${PORT}/posts`);
  console.log(`  Admin:      http://localhost:${PORT}/admin/`);
});
