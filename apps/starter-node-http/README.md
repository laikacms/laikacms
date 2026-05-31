# `@laikacms/starter-node-http`

The **minimum viable** LaikaCMS server. Pure `node:http` + `createEmbeddedLaika`, no framework, no
router library, ~80 LOC. Read `src/server.ts` end-to-end to understand what every other backend
starter does under the hood.

## When to copy this

- You want to understand the moving parts before picking a framework starter (this is the shortest
  path).
- Your target environment can't accommodate a framework dependency tree (rare).
- You're embedding LaikaCMS inside an existing Node.js application that already manages its own HTTP
  layer — adapt the `toWebRequest` / `pipeWebResponse` helpers to plug into it.

For real apps, pick **`starter-hono-backend`**, **`starter-express-backend`**, etc. instead —
they're not much longer and give you routing, middleware, and error handling for free.

## Stack

- `node:http`
- `laikacms` + `@laikacms/decap-integrations/embedded`
- `node:stream`'s `Readable.toWeb` / `Readable.fromWeb` for the adapter

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-node-http dev
```

Then:

- `curl http://localhost:3000/` — endpoint index
- `curl http://localhost:3000/posts` — list published posts
- Open `http://localhost:3000/admin` — Decap CMS admin

## The five things every backend does

Distilled from this file:

1. **Build `laika`** with `createEmbeddedLaika({ contentDir, decapConfig, basePath, auth })`.
2. **Convert `IncomingMessage` → web `Request`** at the boundary (~15 lines): `Readable.toWeb(req)`
   for the body, build a `Headers` object, set `duplex: 'half'`.
3. **Call `laika.fetch(request)`** — same web-standard handler you'd use in Workers / Bun / Hono.
4. **Convert `Response` → `ServerResponse`** by piping `Readable.fromWeb(res.body).pipe(res)`.
5. **For server-side reads, bypass `laika.fetch`** — call `laika.documents.*` directly via `runTask`
   / `collectStream` from `laikacms/compat`. The HTTP API requires auth on every endpoint except
   `/health`; server-internal reads don't need a token.

That's it. Every other backend starter wraps these five steps with router niceties.

## Production hardening

Same as the other starters — but you'll also want to add: graceful shutdown handling
(`process.on('SIGTERM', () => server.close(…))`), keep-alive timeouts, request logging, gzip/brotli
compression at the response boundary. At that point you've reinvented half a framework; consider
switching to one.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
