# starter-hapi-blog

A minimal blog built with [Hapi.js v21](https://hapi.dev) and
[LaikaCMS](https://github.com/laikacms/laikacms).

## What this demonstrates

- **`payload.output: 'data'` bridge**: Hapi pre-drains the request body into a `Buffer` before
  calling the handler — simpler than Express/Koa where you must drain the `IncomingMessage` stream
  manually.
- **`payload.parse: false`**: Disables Hapi's built-in JSON/form parsing so `laika.fetch` receives
  the raw payload.
- **`@hapi/inert` directory handler**: Serves `public/admin/` and `public/uploads/` as static
  directories with automatic index file resolution.
- **Lowercase `request.method`**: Hapi gives `'get'`, `'post'`, etc. — must be `.toUpperCase()`
  before passing to `new Request()` (WHATWG methods are case-sensitive).

## Structure

```
src/
  index.ts        ← Hapi server: routes, bridge functions, HTML rendering
  lib/
    laika.ts      ← singleton createEmbeddedLaika instance
    decap-config.ts ← shared Decap collection schema
public/
  admin/
    index.html    ← Decap CMS admin UI (CDN scripts + bundle.js)
    bundle.js     ← built by `pnpm build:admin` (gitignored)
  uploads/        ← media uploads
content/          ← markdown files managed by Decap
admin-client.ts   ← esbuild entry: registers laika backend, calls CMS.init()
```

## Getting started

```bash
pnpm install
pnpm dev        # builds admin bundle, then starts server on :3000
```

Open `http://localhost:3000` for the blog and `http://localhost:3000/admin/` for the CMS.

## How it works

### Hapi body bridge

Hapi's payload options control how the body is pre-processed before your handler runs:

```typescript
server.route({
  method: '*',
  path: '/api/decap/{path*}',
  options: {
    payload: {
      parse: false, // don't auto-parse JSON/urlencoded — laika handles it
      output: 'data', // drain stream into Buffer before handler runs
      allow: '*/*', // accept any Content-Type
    },
  },
  handler: async (request, h) => {
    const webReq = toLaikaRequest(request);
    return toHapiResponse(await laika.fetch(webReq), h);
  },
});
```

Compare to Express/Koa where you must drain `req` (IncomingMessage) manually via
`for await (const chunk of req)`. Hapi's `output: 'data'` does this for you.

### WHATWG Request construction

```typescript
function toLaikaRequest(request: Hapi.Request): Request {
  const method = request.method.toUpperCase(); // Hapi gives lowercase
  const buf = request.payload as Buffer;
  // TypeScript 6 regression: Buffer not directly assignable to BodyInit.
  const body = buf?.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  return new Request(new URL(request.path, `http://${request.info.host}`), {
    method,
    headers: request.headers as HeadersInit,
    body: method === 'GET' || method === 'HEAD' ? null : body,
  });
}
```

### Content reads

```typescript
import { collectStream, runTask } from 'laikacms/compat';

// List posts
const { items } = await collectStream(
  laika.documents.listRecordSummaries({ folder: 'posts', ... })
);

// Single post
const post = await runTask(laika.documents.getDocument('posts/my-slug'));
```
