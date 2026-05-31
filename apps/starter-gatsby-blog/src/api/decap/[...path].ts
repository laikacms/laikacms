import type { GatsbyFunctionRequest, GatsbyFunctionResponse } from 'gatsby';

import { laika } from '../../lib/laika';

/**
 * Gatsby Function — Decap JSON:API proxy.
 *
 * Doc gap: Gatsby Functions use Express under the hood and pre-parse request
 * bodies (JSON content → `req.body` as a JS object). The raw byte stream is
 * NOT available. For Decap CMS, all API payloads are JSON (including
 * base64-encoded assets), so re-serialising `req.body` back to JSON works.
 *
 * If the Decap backend ever sends non-JSON binary payloads, this proxy would
 * need a more sophisticated adapter. Compare to Hono or Bun where the raw
 * Request is passed through directly.
 *
 * Doc gap: `req.rawUrl` is the full URL (set by adapters) and is the correct
 * field to use for URL reconstruction. `req.url` may be relative or stripped
 * of the prefix by the Function router. Fall back to `req.url` if rawUrl is
 * not set (e.g. in local gatsby develop).
 */
export default async function handler(
  req: GatsbyFunctionRequest,
  res: GatsbyFunctionResponse,
): Promise<void> {
  const host = (req.headers['host'] as string | undefined) ?? 'localhost:8000';
  const url = new URL(req.rawUrl ?? req.url ?? '/', `http://${host}`);

  let body: BodyInit | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body != null) {
    body = JSON.stringify(req.body);
  }

  const webReq = new Request(url.toString(), {
    method: req.method ?? 'GET',
    headers: {
      ...(req.headers as Record<string, string>),
      ...(body != null ? { 'content-type': 'application/json' } : {}),
    },
    body,
  });

  const webRes = await laika.fetch(webReq);

  res.status(webRes.status);
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') {
      res.setHeader(name, value);
    }
  });
  res.send(Buffer.from(await webRes.arrayBuffer()));
}
