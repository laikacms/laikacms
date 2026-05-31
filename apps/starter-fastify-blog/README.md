# starter-fastify-blog

Minimal blog built with [Fastify](https://fastify.dev) v5 and LaikaCMS. Demonstrates:

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config syncing, documents
  repo, and the Decap JSON:API fetch handler.
- **`laika.documents.*` via `laikacms/compat`** — `runTask` / `collectStream` give Promise-friendly
  access to content without importing Effect.
- **Fastify → Web API bridge** — `laika.fetch` expects a WHATWG `Request`; Fastify exposes its own
  `FastifyRequest`. We reconstruct a `Request` from the buffered body and raw URL.
- **Decap admin from CDN** — `decap-cms.js` loaded from unpkg; the laika backend plugin is bundled
  by esbuild from `@laikacms/decap-integrations`.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin/> for the CMS editor (dev
auth — no login required).

## Project layout

```
src/
  decap-config.ts     # Shared collection schema (server + admin)
  laika.ts            # createEmbeddedLaika singleton
  index.ts            # Fastify server — routes + static files
  admin-client.ts     # Bundled for browser: registers laika backend
public/
  admin/
    index.html        # Decap admin UI (Decap from CDN)
    bundle.js         # Built from admin-client.ts by esbuild
content/              # Filesystem content root (git-tracked)
```

## Doc gap: Fastify body parsing vs. raw forwarding

Fastify's default behaviour parses request bodies — `application/json` becomes a JS object,
`application/x-www-form-urlencoded` becomes a key-value map, etc. This is great for API handlers but
breaks when you need to forward the **raw bytes** to `laika.fetch`.

The fix is a catch-all content-type parser registered **before any routes**:

```ts
fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body as Buffer);
});
```

This stores the raw bytes in `request.body` as a `Buffer` for every route. Then in the proxy route:

```ts
const rawBody = request.body as Buffer | null | undefined;
const body = rawBody?.byteLength
  ? rawBody.buffer.slice(rawBody.byteOffset, rawBody.byteOffset + rawBody.byteLength) as ArrayBuffer
  : undefined;
const webReq = new Request(
  url,
  { method, headers, body, ...(body ? { duplex: 'half' } : {}) } as RequestInit,
);
```

If you only need the raw body for `/api/decap/*` and want normal parsing elsewhere, use a scoped
Fastify plugin with its own `addContentTypeParser` registration.

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Deployment

```bash
pnpm start   # or: NODE_ENV=production tsx src/index.ts
```

Set `PORT` to override the default 3000. Point a reverse proxy (nginx, Caddy) at the Node server.
