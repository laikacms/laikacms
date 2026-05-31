import { Readable } from 'node:stream';

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Fastify ↔ Web Standards adapter.
 *
 * Fastify wraps Node's `IncomingMessage` / `ServerResponse` in `request.raw`
 * / `reply.raw`. The bridging logic is the same as for Express: build a Web
 * `Request` from the raw `req`, hand it to a `(Request) => Promise<Response>`
 * handler, and pipe the Response.body back to `reply.raw`.
 *
 * Crucially, this handler **disables Fastify's body parser** for its route
 * (see `mountWebFetchHandler` below) — otherwise the request body would be
 * drained before we ever see it.
 */
function toWebRequest(req: FastifyRequest): Request {
  const protocol = (req.headers['x-forwarded-proto'] as string) || (req.raw.socket as { encrypted?: boolean }).encrypted
    ? 'https'
    : 'http';
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url, `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
    else if (value !== undefined) headers.set(key, String(value));
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req.raw) as unknown as ReadableStream;
    init.duplex = 'half';
  }

  return new Request(url, init);
}

async function sendWebResponse(reply: FastifyReply, webResponse: Response): Promise<void> {
  reply.status(webResponse.status);
  webResponse.headers.forEach((value, key) => reply.header(key, value));
  if (webResponse.body) {
    const nodeStream = Readable.fromWeb(
      webResponse.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
    reply.send(nodeStream);
  } else {
    reply.send();
  }
}

/**
 * Returns a Fastify route handler that forwards every method to a
 * web-standard fetch handler. Register it with `bodyLimit: 0` and
 * `parserOptions` cleared so Fastify doesn't drain the body first.
 *
 * @example
 *   fastify.all('/api/decap/*', {
 *     // Disable Fastify's body parser for this route — the adapter streams
 *     // the raw body to laika.fetch instead.
 *     config: { rawBody: true },
 *   }, mountWebFetchHandler(req => laika.fetch(req)));
 */
export function mountWebFetchHandler(
  handler: (request: Request) => Promise<Response>,
) {
  return async function(this: unknown, request: FastifyRequest, reply: FastifyReply) {
    const webRequest = toWebRequest(request);
    const webResponse = await handler(webRequest);
    await sendWebResponse(reply, webResponse);
  };
}
