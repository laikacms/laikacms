import { Readable } from 'node:stream';

import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

/**
 * Express ↔ Web Standards adapter.
 *
 * Express handlers receive Node.js `IncomingMessage` / `ServerResponse` wrappers
 * (`req` / `res`). LaikaCMS's `laika.fetch(request)` expects a web-standard
 * `Request` and returns a web-standard `Response`. This module bridges the two
 * with no third-party dependencies.
 *
 * Usage:
 *
 *   import { mountWebFetchHandler } from './express-fetch-adapter';
 *   app.all('/api/decap/*', mountWebFetchHandler(req => laika.fetch(req)));
 *
 * Caveats:
 *   - `req.body` is **not** consumed here; we forward the raw stream. Do NOT
 *     mount `express.json()` (or any other body parser) in front of this
 *     route, or the body will already be drained.
 *   - The adapter is one-shot per request. The `duplex: 'half'` init flag
 *     keeps it compatible with streaming bodies on Node ≥ 18.
 */
export function toWebRequest(req: ExpressRequest): Request {
  const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.originalUrl || req.url, `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // The Node and DOM type definitions disagree on `ReadableStream`'s
    // generic parameters. The runtime objects are interoperable, so we
    // bridge through `unknown`.
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
    init.duplex = 'half';
  }

  return new Request(url, init);
}

export async function sendWebResponse(
  res: ExpressResponse,
  webResponse: Response,
): Promise<void> {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));
  if (webResponse.body) {
    await new Promise<void>((resolveFn, rejectFn) => {
      // Same type-bridge as in toWebRequest — runtime is fine, type defs disagree.
      const nodeStream = Readable.fromWeb(
        webResponse.body as unknown as Parameters<typeof Readable.fromWeb>[0],
      );
      nodeStream.on('error', rejectFn);
      nodeStream.on('end', resolveFn);
      nodeStream.pipe(res);
    });
  } else {
    res.end();
  }
}

/**
 * Mount a web-standard `(Request) => Promise<Response>` as an Express handler.
 * Errors propagate to Express's `next(err)` so the standard error middleware
 * sees them.
 */
export function mountWebFetchHandler(
  handler: (request: Request) => Promise<Response>,
) {
  return async (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => {
    try {
      const webRequest = toWebRequest(req);
      const webResponse = await handler(webRequest);
      await sendWebResponse(res, webResponse);
    } catch (err) {
      next(err);
    }
  };
}
