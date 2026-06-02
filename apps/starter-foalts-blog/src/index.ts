// reflect-metadata must be imported before any FoalTS code.
import 'reflect-metadata';

import * as http from 'node:http';

import { createApp } from '@foal/core';
import express from 'express';

import { AppController } from './app/app.controller.js';
import { laika } from './app/laika.js';

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  // ── Outer Express wrapper ─────────────────────────────────────────────────
  // FoalTS's createApp registers its own body parser.  Any middleware added
  // to the FoalTS app after the fact runs AFTER body parsing, so it can no
  // longer read the raw stream for multipart / binary uploads.
  //
  // The fix: create a bare Express app, register express.raw() on it first
  // for the Decap API prefix, then mount the FoalTS app beneath it.
  // Requests to /api/decap/* never reach the FoalTS body parser.
  const outer = express();

  // ── Decap JSON:API proxy ──────────────────────────────────────────────────
  // express.raw() buffers the body into req.body as a Buffer before any
  // framework-level body parser runs.  We then reconstruct a WHATWG Request
  // and forward it to laika.fetch.
  outer.use(
    '/api/decap',
    express.raw({ type: '*/*', limit: '50mb' }),
    async (req, res) => {
      const url = `http://localhost:${PORT}${req.originalUrl}`;
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const body = hasBody && Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null;

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

  // ── FoalTS app (blog + admin) ─────────────────────────────────────────────
  const foalApp = await createApp(AppController);
  outer.use(foalApp as express.RequestHandler);

  http.createServer(outer).listen(PORT, () => {
    console.log(`FoalTS blog running at http://localhost:${PORT}`);
    console.log(`  Blog:  http://localhost:${PORT}/`);
    console.log(`  Admin: http://localhost:${PORT}/admin/`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
