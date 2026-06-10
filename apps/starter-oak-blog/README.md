# starter-oak-blog

A minimal blog built with **[Oak](https://jsr.io/@oak/oak)** (Deno's most popular HTTP middleware
framework) + **LaikaCMS**.

## What this demonstrates

- Oak middleware + Router pattern for Deno
- `createEmbeddedLaika` with `node:fs`/`node:path` via Deno's Node.js compat
- Bridging Oak's `Context` → WHATWG `Request` for `laika.fetch`
- Decap CMS admin served from CDN (`decapAdminHtml`) — no esbuild step
- `collectStream` / `runTask` from `laikacms/compat` for direct document access

## Quick start

```bash
# Requires Deno 2.x
deno task dev
# http://localhost:3000        ← blog
# http://localhost:3000/admin/ ← Decap CMS (dev auth, no login needed)
```

## Project structure

```
src/
  main.ts          Oak Application + Router (all routes)
  lib/
    laika.ts       createEmbeddedLaika singleton + ADMIN_HTML
content/           Markdown posts (managed by Decap CMS)
public/uploads/    Media uploads
deno.json          Deno tasks + JSR import map (@oak/oak)
```

## Bridging Oak → laika.fetch

Oak wraps the native Deno `Request` in its own type, so you can't pass `ctx.request` to
`laika.fetch` directly. Reconstruct a WHATWG Request:

```ts
const body = ctx.request.hasBody ? await ctx.request.body.arrayBuffer() : null;
const req = new Request(ctx.request.url.href, {
  method: ctx.request.method,
  headers: ctx.request.headers,
  body: body && body.byteLength > 0 ? body : null,
});
const res = await laika.fetch(req);
ctx.response.status = res.status;
res.headers.forEach((v, k) => ctx.response.headers.set(k, v));
ctx.response.body = res.body ?? new Uint8Array(0);
```

**Compare to:**

- **Hono / Elysia** — expose the native `Request` directly, so `laika.fetch(ctx.req.raw)` works with
  zero adaptation.
- **Express / Fastify / Koa** — require an `IncomingMessage → Request` bridge (more involved than
  Oak's).
- **Deno.serve / Bun.serve** — the handler receives a native `Request`, no bridge at all.

## Routing the Decap proxy

Oak's URLPattern router doesn't match arbitrary path suffixes after a named segment cleanly. A
top-level middleware pathname check is simpler:

```ts
app.use(async (ctx, next) => {
  if (ctx.request.url.pathname.startsWith('/api/decap')) {
    await proxyToLaika(ctx);
    return;
  }
  return next();
});
```

This ensures all `/api/decap/*` traffic is handled before the router runs.

## Production hardening

- Set `auth: { mode: 'jwt', secret: process.env.JWT_SECRET }` in `laika.ts`.
- Replace `Deno.env.get('PORT') ?? 3000` with your platform's port binding.
- Add TLS termination via a reverse proxy (nginx, Caddy) or `app.listen({ secure: true, ... })`.
