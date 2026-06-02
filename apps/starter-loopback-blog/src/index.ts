/**
 * Doc gap (LoopBack 4 body-parser bypass):
 *
 * LoopBack 4 mounts its own body-parser middleware at the PARSE_PARAMS
 * sequence point.  Mounting laika.fetch inside a LoopBack controller would
 * mean the request body is already consumed before our handler runs.
 *
 * Solution: use the same outer-Express-wrapper pattern as FoalTS.
 * LoopBack 4 exposes `app.requestHandler` — an Express middleware that
 * covers all LoopBack routes.  We mount it AFTER registering our Decap
 * proxy route, so LoopBack never sees those requests.
 *
 * Important: do NOT call app.start() — that would bind a second HTTP server.
 * app.boot() + app.requestHandler is enough.
 */

import 'reflect-metadata';
import * as http from 'node:http';

import express from 'express';

import { BlogApplication } from './application.js';
import { ADMIN_HTML, laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  const app = new BlogApplication();
  // init() loads components and resolves bindings without starting LoopBack's
  // own HTTP server.  Do NOT call start() — that would bind a second port.
  await app.init();

  const outer = express();

  // ── Decap JSON:API proxy ───────────────────────────────────────────────────
  // express.raw() gives us the pristine body Buffer before LoopBack's parser
  // ever runs.  We must register this route BEFORE app.requestHandler.
  outer.use(
    '/api/decap',
    express.raw({ type: '*/*', limit: '50mb' }),
    async (req: express.Request, res: express.Response) => {
      const url = `http://localhost:${PORT}${req.originalUrl}`;
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const rawBuf: Buffer | undefined = hasBody && Buffer.isBuffer(req.body) && req.body.length > 0
        ? (req.body as Buffer)
        : undefined;
      // TypeScript 6: Buffer<ArrayBufferLike> is not assignable to BodyInit.
      // Extract the underlying ArrayBuffer slice instead.
      const body: ArrayBuffer | null = rawBuf
        ? (rawBuf.buffer.slice(
          rawBuf.byteOffset,
          rawBuf.byteOffset + rawBuf.byteLength,
        ) as ArrayBuffer)
        : null;

      const webReq = new Request(url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body,
      });

      const webRes = await laika.fetch(webReq);
      res.status(webRes.status);
      webRes.headers.forEach((value: string, name: string) => {
        if (name.toLowerCase() !== 'transfer-encoding') {
          res.setHeader(name, value);
        }
      });
      res.send(Buffer.from(await webRes.arrayBuffer()));
    },
  );

  // ── Admin UI ───────────────────────────────────────────────────────────────
  outer.get('/admin', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(ADMIN_HTML);
  });

  // ── LoopBack 4 handles all remaining routes ────────────────────────────────
  // requestHandler is an Express RequestHandler covering all registered
  // controllers.  It runs LoopBack's full middleware sequence (CORS, auth,
  // param parsing, controller invocation) but never receives Decap traffic.
  outer.use(app.requestHandler as express.RequestHandler);

  http.createServer(outer).listen(PORT, () => {
    console.log(`LoopBack 4 + LaikaCMS running at http://localhost:${PORT}`);
    console.log(`  Blog: http://localhost:${PORT}/`);
    console.log(`  Admin: http://localhost:${PORT}/admin`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
