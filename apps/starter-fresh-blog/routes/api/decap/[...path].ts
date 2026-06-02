import { type Handlers } from '$fresh/server.ts';

import { laika } from '../../../lib/laika.ts';

/**
 * Proxy all HTTP methods to laika.fetch.
 *
 * Fresh's handlers receive a WHATWG Request and must return a WHATWG Response —
 * the same interface laika.fetch speaks. No adapter is needed here (contrast
 * with Express/Fastify/Koa starters that need an IncomingMessage → Request
 * bridge). This is one of Fresh's ergonomic advantages for LaikaCMS integration.
 */
const handle = (req: Request) => laika.fetch(req);

export const handler: Handlers = {
  GET: handle,
  POST: handle,
  PUT: handle,
  DELETE: handle,
  PATCH: handle,
  HEAD: handle,
  OPTIONS: handle,
};
