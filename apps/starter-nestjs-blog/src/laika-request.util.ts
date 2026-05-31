import type { Request as ExpressReq } from 'express';

/**
 * NestJS (via @nestjs/platform-express) uses Express's IncomingMessage under
 * the hood, not the WHATWG Fetch API. laika.fetch expects a Web API Request,
 * so this helper bridges the two.
 *
 * Doc gap: laika.fetch takes a Web API Request, not Node's IncomingMessage.
 * WHATWG-native frameworks (Hono, Astro, Remix, Nuxt via h3) need no adapter.
 * Express-based frameworks (Express, NestJS/Express, Fastify) need one.
 */
export async function toLaikaRequest(req: ExpressReq): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url, `http://${host}`);

  let body: ArrayBuffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) chunks.push(new Uint8Array(chunk as Buffer));
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    if (total > 0) {
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      body = merged.buffer;
    }
  }

  return new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body,
  });
}

export async function sendLaikaResponse(webRes: Response, res: import('express').Response): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
  });
  res.send(Buffer.from(await webRes.arrayBuffer()));
}
