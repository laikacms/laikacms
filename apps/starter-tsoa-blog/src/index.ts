/**
 * Doc gap (tsoa body-parser bypass):
 *
 * tsoa generates an Express router from controller decorators at build time
 * (`tsoa routes` → src/generated/routes.ts).  The generated router does NOT
 * install a body parser for non-JSON bodies, so the IncomingMessage stream is
 * still pristine when the `/api/decap` Express middleware runs.
 *
 * The trick: register the Decap proxy route BEFORE registering the tsoa
 * generated router.  Use `express.raw()` so the body is available as a Buffer
 * when we forward it to laika.fetch.
 *
 * tsoa @Produces('text/html') tells the generated router to skip JSON
 * serialisation for routes that return HTML strings.
 */

import * as http from 'node:http';

import express from 'express';

import { RegisterRoutes } from './generated/routes.js';
import { ADMIN_HTML, laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  const app = express();

  // ── Decap JSON:API proxy ─────────────────────────────────────────────────
  // Must come before RegisterRoutes so tsoa never sees these requests.
  // express.raw() captures the pristine body buffer; tsoa's generated code
  // uses express.json() internally only for JSON routes, so raw streams are
  // still intact when we mount this first.
  app.use(
    '/api/decap',
    express.raw({ type: '*/*', limit: '50mb' }),
    async (req: express.Request, res: express.Response) => {
      const url = `http://localhost:${PORT}${req.originalUrl}`;
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const rawBuf: Buffer | undefined = hasBody && Buffer.isBuffer(req.body) && req.body.length > 0
        ? (req.body as Buffer)
        : undefined;
      const body: ArrayBuffer | null = rawBuf
        ? (rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength) as ArrayBuffer)
        : null;

      const webReq = new Request(url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body,
      });
      const webRes = await laika.fetch(webReq);
      res.status(webRes.status);
      webRes.headers.forEach((value: string, name: string) => {
        if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
      });
      res.send(Buffer.from(await webRes.arrayBuffer()));
    },
  );

  // ── Admin UI ─────────────────────────────────────────────────────────────
  app.get('/admin', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(ADMIN_HTML);
  });

  // ── tsoa generated router ─────────────────────────────────────────────────
  // RegisterRoutes wires up all @Route / @Get / @Post decorated controllers
  // and installs express.json() for JSON routes.  It must run after the Decap
  // proxy or it would install its own json body parser first.
  RegisterRoutes(app);

  http.createServer(app).listen(PORT, () => {
    console.log(`tsoa + LaikaCMS running at http://localhost:${PORT}`);
    console.log(`  Blog: http://localhost:${PORT}/`);
    console.log(`  Admin: http://localhost:${PORT}/admin`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
