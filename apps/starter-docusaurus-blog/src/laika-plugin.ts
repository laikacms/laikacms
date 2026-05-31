import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Plugin } from '@docusaurus/types';

import { laika } from './laika.js';

/**
 * Bridge Node.js IncomingMessage → Web API Request for laika.fetch.
 *
 * Docusaurus uses webpack-dev-server (Node.js IncomingMessage/ServerResponse),
 * so we reconstruct a Web API Request manually, buffering the body so that Decap
 * write operations (POST/PUT/DELETE) work correctly.
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

  return new Request(url.toString(), {
    method: req.method ?? 'GET',
    headers: req.headers as Record<string, string>,
    ...(body ? { body, duplex: 'half' } : {}),
  } as RequestInit);
}

/**
 * Docusaurus plugin that injects the Decap JSON:API handler into the dev server.
 *
 * Doc note: Docusaurus v3's Plugin API does not have a `configureDevServer`
 * lifecycle hook. Instead, inject middleware via `configureWebpack`, returning
 * a partial webpack config with `devServer.setupMiddlewares`. This hook is only
 * called for the client-side build (`isServer === false`), which is the only
 * build that runs the dev server.
 *
 * webpack-dev-server v5 deprecated the older `before`/`onBeforeSetupMiddleware`
 * hooks in favour of `setupMiddlewares(middlewares, devServer)`.
 * `devServer.app` is the underlying Express Application.
 *
 * In production, Docusaurus generates a purely static site and the API must be
 * hosted separately if the CMS admin is needed.
 */
export default function laikaDecapPlugin(): Plugin {
  return {
    name: 'laika-decap-api',

    configureWebpack(_config, isServer) {
      if (isServer) return;

      // Use unknown cast: devServer.setupMiddlewares in webpack-dev-server v5 expects
      // its own Middleware[] and WebpackDevServer types — not in our direct deps.
      // The object shape is correct at runtime; TypeScript just can't verify the
      // structural match without the full webpack-dev-server type available.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {
        devServer: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setupMiddlewares(middlewares: any[], devServer: any) {
            devServer.app.use('/api/decap', async (req: IncomingMessage, res: ServerResponse) => {
              try {
                const webReq = await toWebRequest(req);
                const webRes = await laika.fetch(webReq);

                const resHeaders: Record<string, string> = {};
                webRes.headers.forEach((value, name) => {
                  if (name.toLowerCase() !== 'transfer-encoding') resHeaders[name] = value;
                });

                res.writeHead(webRes.status, resHeaders);
                res.end(Buffer.from(await webRes.arrayBuffer()));
              } catch (err) {
                console.error('[laika-decap-api]', err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
              }
            });

            return middlewares;
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    },
  };
}
