/**
 * Decap JSON:API proxy.
 *
 * AdonisJS wraps the Node.js IncomingMessage in its own Request class.
 * The underlying raw request/response are at:
 *   ctx.request.request  → Node.js IncomingMessage
 *   ctx.response.response → Node.js ServerResponse
 *
 * We bridge to WHATWG Request/Response so laika.fetch() receives a spec-
 * compliant request, then write the laika response directly to the raw
 * ServerResponse (bypassing AdonisJS's response buffering so that streaming
 * uploads work correctly).
 */
import type { HttpContext } from '@adonisjs/core/http';
import { Readable } from 'node:stream';

import { laika } from '#services/laika';

export default class DecapController {
  async proxy({ request, response }: HttpContext) {
    const req = request.request; // raw IncomingMessage
    const res = response.response; // raw ServerResponse

    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url!, `http://${host}`);

    // Collect body — AdonisJS body-parser may not have run for non-JSON content types,
    // so we read the raw stream directly.
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const body = Buffer.concat(chunks);

    const webRequest = new Request(url.toString(), {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: body.byteLength > 0 && req.method !== 'GET' && req.method !== 'HEAD'
        ? (body.buffer.slice(
          body.byteOffset,
          body.byteOffset + body.byteLength,
        ) as ArrayBuffer)
        : null,
      ...(body.byteLength > 0 ? { duplex: 'half' } : {}),
    } as RequestInit);

    const webResponse = await laika.fetch(webRequest);

    res.statusCode = webResponse.status;
    webResponse.headers.forEach((value: string, name: string) => {
      if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
    });

    if (webResponse.body) {
      Readable.fromWeb(webResponse.body as import('stream/web').ReadableStream).pipe(res);
    } else {
      res.end();
    }

    // Mark AdonisJS response as finished so it does not attempt to send again.
    response.finish();
  }
}
