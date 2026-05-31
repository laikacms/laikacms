/**
 * Express + Vike server.
 *
 * Two modes:
 *
 * Dev (NODE_ENV !== 'production'):
 *   - Vite dev server runs in middleware mode, handling HMR and SSR transforms.
 *   - Express mounts Vite's Connect-compatible middleware before Vike's page
 *     renderer, so asset requests and HMR WebSocket traffic go through Vite.
 *
 * Production:
 *   - Run `vite build` first.
 *   - Express serves `dist/client/` as static files.
 *   - `renderPage` uses the pre-built server bundle.
 *
 * In both modes:
 *   - `/api/decap/*` is handled first by laika.fetch.
 *   - All remaining requests go to Vike's renderPage.
 *
 * Doc gap: Vike's renderPage accepts a standard URL string (urlOriginal) and
 * returns an httpResponse object. There is no web-standard Request/Response
 * involved — Vike manages SSR internally and works with any HTTP framework
 * that can supply a URL and write a response body.
 */
import express from 'express';
import { renderPage } from 'vike/server';
import { createServer as createViteServer } from 'vite';

import { laika } from '../src/laika.js';

const isDev = process.env.NODE_ENV !== 'production';
const app = express();

if (isDev) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });
  // Vite's Connect middleware handles HMR, asset transforms, and module resolution.
  app.use(vite.middlewares);
} else {
  // Serve Vite's built client assets (JS, CSS, images).
  app.use(express.static('dist/client'));
}

/**
 * Decap JSON:API proxy.
 *
 * laika.fetch expects a WHATWG Request. Express 5 provides req as
 * IncomingMessage (not WHATWG Request), so we reconstruct one from the
 * raw body + URL. This matches the pattern in starter-express-blog.
 */
app.all('/api/decap/*', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url, `${protocol}://${host}`);

  const rawBody = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;
  const body: BodyInit | undefined = rawBody
    ? (rawBody.buffer.slice(rawBody.byteOffset, rawBody.byteOffset + rawBody.byteLength) as ArrayBuffer)
    : undefined;

  const request = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body,
  });

  const response = await laika.fetch(request);

  res.status(response.status);
  response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
});

/**
 * All remaining requests → Vike page renderer.
 *
 * renderPage takes the URL, runs the matching +data.ts loader (server-only),
 * renders the React component tree to HTML, and returns the result.
 * The Express handler writes the status, headers, and body.
 */
app.all('*', async (req, res) => {
  const pageContext = await renderPage({ urlOriginal: req.originalUrl });
  const { httpResponse } = pageContext;

  if (!httpResponse) {
    res.status(404).send('Not found');
    return;
  }

  const { body, statusCode, headers } = httpResponse;
  headers.forEach(([name, value]: [string, string]) => res.setHeader(name, value));
  res.status(statusCode).send(body);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Blog:  http://localhost:${port}`);
  console.log(`Admin: http://localhost:${port}/admin`);
});
