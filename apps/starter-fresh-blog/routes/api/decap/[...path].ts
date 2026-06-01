import type { Handlers } from '$fresh/server.ts';

import { laika } from '../../../lib/laika.ts';

/**
 * Catch-all Decap JSON:API proxy.
 *
 * Fresh's Handlers receive a WHATWG Request — the same type laika.fetch
 * expects — so no bridging is needed, the proxy is a single line per method.
 *
 * Fresh resolves [...path] catch-all segments, so /api/decap/config.yml,
 * /api/decap/health, and all nested paths land here.
 */
const proxy = (req: Request) => laika.fetch(req);

export const handler: Handlers = {
  GET: proxy,
  POST: proxy,
  PUT: proxy,
  DELETE: proxy,
  PATCH: proxy,
  HEAD: proxy,
  OPTIONS: proxy,
};
