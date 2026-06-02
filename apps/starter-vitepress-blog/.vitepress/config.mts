import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineConfig } from 'vitepress';

import { laika } from '../src/laika.js';

/**
 * Bridge Node.js IncomingMessage → Web API Request for laika.fetch.
 *
 * VitePress uses Vite's dev server which runs on Node.js (Connect middleware
 * stack), so incoming requests are IncomingMessage — not the Web API Request
 * that laika.fetch expects. We reconstruct a Request manually, buffering the
 * body into an ArrayBuffer to support POST/PUT/PATCH writes from Decap CMS.
 */
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  let body: ArrayBuffer | undefined;
  if (total > 0) {
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    body = merged.buffer;
  }

  const method = req.method ?? 'GET';
  const headers = req.headers as Record<string, string>;

  return new Request(url.toString(), {
    method,
    headers,
    ...(body ? { body, duplex: 'half' } : {}),
  } as RequestInit);
}

export default defineConfig({
  title: 'My Blog',
  description: 'A blog powered by VitePress and LaikaCMS',
  srcDir: '.',
  outDir: './.vitepress/dist',

  vite: {
    plugins: [
      {
        name: 'laika-decap-api',
        /**
         * Inject the Decap JSON:API handler into VitePress's Vite dev server.
         *
         * Doc note: VitePress exposes vite.plugins so you can tap into
         * configureServer without ejecting from VitePress. configureServer
         * receives a ViteDevServer whose .middlewares property is a Connect
         * instance — use server.middlewares.use(path, fn) to register middleware.
         *
         * This avoids running a second process just for the Decap API during
         * development; everything runs on VitePress's single dev server port.
         */
        configureServer(server) {
          server.middlewares.use('/api/decap', async (req: IncomingMessage, res: ServerResponse) => {
            try {
              const webReq = await toWebRequest(req);
              const webRes = await laika.fetch(webReq);

              const resHeaders: Record<string, string> = {};
              webRes.headers.forEach((value, name) => {
                if (name.toLowerCase() !== 'transfer-encoding') resHeaders[name] = value;
              });

              res.writeHead(webRes.status, resHeaders);
              const buf = Buffer.from(await webRes.arrayBuffer());
              res.end(buf);
            } catch (err) {
              console.error('[laika-decap-api]', err);
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Internal Server Error');
            }
          });
        },
      },
    ],
  },
});
