import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Bridge a NestJS/Fastify request to a WHATWG Fetch Request for laika.fetch.
 *
 * Doc gap — Fastify body pre-parsing:
 *   Unlike NestJS/Express (where you can stream raw bytes from IncomingMessage),
 *   Fastify pre-parses JSON bodies before route handlers run. `req.body` is a
 *   JavaScript object; the raw byte stream has already been consumed.
 *
 *   For the Decap JSON:API this is acceptable: every Decap payload is JSON
 *   (including base64-encoded media uploads). We re-serialize req.body via
 *   JSON.stringify(), set Content-Type: application/json, and forward.
 *
 *   If Decap ever sends non-JSON binary payloads (not currently the case), this
 *   bridge would need a rawBody Fastify plugin or a custom content-type parser
 *   that preserves the raw buffer.
 *
 *   Compare with starter-nestjs-blog (Express): there, raw bytes are streamed
 *   from req (IncomingMessage) without pre-parsing, which is more correct but
 *   requires care to avoid body-parser middleware interference.
 *
 *   Same "JSON re-serialize" pattern is used by the Gatsby starter for the
 *   same reason (Gatsby Functions pre-parse bodies too).
 */
export async function toLaikaRequest(req: FastifyRequest): Promise<Request> {
  const host = (req.headers.host as string | undefined) ?? 'localhost';
  const url = new URL(req.url, `http://${host}`);

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body != null) {
    body = JSON.stringify(req.body);
  }

  return new Request(url.toString(), {
    method: req.method,
    headers: {
      ...(req.headers as Record<string, string>),
      ...(body != null ? { 'content-type': 'application/json' } : {}),
    },
    body,
  });
}

export async function sendLaikaResponse(webRes: Response, reply: FastifyReply): Promise<void> {
  reply.code(webRes.status);
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') reply.header(name, value);
  });
  reply.send(Buffer.from(await webRes.arrayBuffer()));
}
