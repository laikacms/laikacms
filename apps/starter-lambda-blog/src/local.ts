/**
 * Local development server — wraps handleRequest in a plain Node.js HTTP server
 * so you can run `pnpm dev` without deploying to AWS.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleRequest } from './app.js';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

async function nodeReqToWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? `localhost:${PORT}`;
  const url = new URL(req.url ?? '/', `http://${host}`);

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
      body = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength) as ArrayBuffer;
    }
  }

  return new Request(url, {
    method: req.method ?? 'GET',
    headers: req.headers as Record<string, string>,
    body,
  });
}

async function sendWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
  });
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const webReq = await nodeReqToWebRequest(req);
    const webRes = await handleRequest(webReq);
    await sendWebResponse(webRes, res);
  } catch (err) {
    console.error('Unhandled error:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`[starter-lambda-blog] dev server → http://localhost:${PORT}`);
  console.log(`  Admin UI  → http://localhost:${PORT}/admin/`);
});
