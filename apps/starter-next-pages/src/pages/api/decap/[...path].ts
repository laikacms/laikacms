import type { NextApiRequest, NextApiResponse } from 'next';

import { laika } from '@/lib/laika';

/**
 * Pages Router API route — these still receive Node's `req`/`res` (not
 * web-standard Request/Response). We adapt at the boundary using the same
 * Readable.toWeb / Readable.fromWeb trick as the Express/Fastify starters.
 *
 * For new projects on Next.js, prefer the App Router (cloud routine's
 * `starter-next-blog`) which speaks web standards natively — this starter
 * exists because so many existing Next.js projects are still on Pages Router
 * and can't migrate today.
 */
import { Readable } from 'node:stream';

export const config = {
  api: {
    // Prevent Next from JSON-parsing the body — the adapter streams the raw
    // request to laika.fetch.
    bodyParser: false,
  },
};

async function adapt(req: NextApiRequest): Promise<Request> {
  const protocol = (req.headers['x-forwarded-proto'] as string) || 'http';
  const url = new URL(req.url ?? '/', `${protocol}://${req.headers.host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method ?? 'GET',
    headers,
  };
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const webRequest = await adapt(req);
  const webResponse = await laika.fetch(webRequest);

  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));

  if (webResponse.body) {
    const nodeStream = Readable.fromWeb(
      webResponse.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
    nodeStream.pipe(res);
  } else {
    res.end();
  }
}
