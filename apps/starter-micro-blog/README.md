# starter-micro-blog

A minimal blog built with [micro v10](https://github.com/vercel/micro) and
[LaikaCMS](https://github.com/laikacms/laikacms).

## What this demonstrates

- **`micro.buffer(req)`** — the most concise way to drain a Node.js `IncomingMessage` stream into a
  `Buffer`. No manual `for await (const chunk of req)` loop needed.
- **`micro.serve(handler)`** — wraps a handler with automatic error handling. If the handler throws,
  micro sends a proper JSON error response.
- **`micro.send(res, status, body)`** — type-aware response helper.

## The bridge pattern comparison

All three approaches to draining an IncomingMessage body are equivalent:

```typescript
// Express/Polka (manual loop)
const chunks: Uint8Array[] = [];
for await (const chunk of req) chunks.push(chunk);
const body = Buffer.concat(chunks);

// Hapi (framework option)
// payload: { parse: false, output: 'data' }
// → request.payload is already a Buffer when handler runs

// micro (utility function)
const body = await buffer(req, { limit: '10mb' });
```

## Structure

```
src/
  index.ts         ← micro handler, routing, HTML rendering
  lib/
    laika.ts       ← singleton createEmbeddedLaika instance
    decap-config.ts ← shared Decap collection schema
public/
  admin/           ← Decap CMS admin UI
  uploads/         ← media uploads
content/           ← markdown files
admin-client.ts    ← esbuild entry: registers laika backend
```

## Getting started

```bash
pnpm install
pnpm dev        # builds admin bundle, then starts server on :3000
```

Open `http://localhost:3000` for the blog and `http://localhost:3000/admin/` for the CMS.

## How it works

### Bridge

```typescript
import { buffer } from 'micro';

async function toLaikaRequest(req: IncomingMessage): Promise<Request> {
  const buf = await buffer(req, { limit: '10mb' });
  const body = buf.byteLength > 0
    ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    : undefined;

  return new Request(url, {
    method: req.method?.toUpperCase() ?? 'GET',
    headers: req.headers as HeadersInit,
    body: body ?? null,
  });
}
```

### Content reads

```typescript
import { collectStream, runTask } from 'laikacms/compat';

const { items } = await collectStream(
  laika.documents.listRecordSummaries({ folder: 'posts', ... })
);

const post = await runTask(laika.documents.getDocument('posts/my-slug'));
```
