import { Readable } from 'node:stream';

import type Koa from 'koa';

/**
 * Koa ↔ Web Standards adapter.
 *
 * Koa middleware sees `ctx.req` (Node IncomingMessage) and `ctx.res` (Node
 * ServerResponse). The same bridging trick used in the Express and Fastify
 * starters works here: build a Web `Request` from `ctx.req`, run it through
 * a `(Request) => Promise<Response>` handler, and pipe the Response back
 * via `ctx.body = nodeStream` (Koa handles streams natively).
 *
 * Koa-specific note: setting `ctx.body` to a Readable stream is the
 * canonical way to stream a response. Koa pipes it to `ctx.res` for you and
 * sets `Transfer-Encoding: chunked` if no Content-Length is known.
 */
function toWebRequest(ctx: Koa.Context): Request {
  const protocol = ctx.protocol === 'https' ? 'https' : 'http';
  const url = new URL(ctx.originalUrl, `${protocol}://${ctx.host || 'localhost'}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(ctx.req.headers)) {
    if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: ctx.method,
    headers,
  };

  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    init.body = Readable.toWeb(ctx.req) as unknown as ReadableStream;
    init.duplex = 'half';
  }

  return new Request(url, init);
}

/**
 * Returns a Koa middleware that forwards every request to a web-standard
 * fetch handler.
 *
 * @example
 *   router.all('/api/decap/(.*)', mountWebFetchHandler(req => laika.fetch(req)));
 */
export function mountWebFetchHandler(
  handler: (request: Request) => Promise<Response>,
) {
  return async (ctx: Koa.Context) => {
    const webRequest = toWebRequest(ctx);
    const webResponse = await handler(webRequest);

    ctx.status = webResponse.status;
    webResponse.headers.forEach((value, key) => ctx.set(key, value));
    if (webResponse.body) {
      ctx.body = Readable.fromWeb(
        webResponse.body as unknown as Parameters<typeof Readable.fromWeb>[0],
      );
    } else {
      ctx.body = null;
    }
  };
}
