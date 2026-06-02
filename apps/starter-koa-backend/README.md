# `@laikacms/starter-koa-backend`

A **Koa 2** backend that hosts the LaikaCMS web-standard `fetch` handler. Completes the Node backend
quartet — pick the one that matches your existing app:

| Framework | When to pick it                                                                    |
| --------- | ---------------------------------------------------------------------------------- |
| Hono      | Greenfield, want web-standard request/response natively, multi-runtime portability |
| Express   | You already have an Express app                                                    |
| Fastify   | You need Fastify's plugin ecosystem or perf optimizations                          |
| **Koa**   | You prefer Koa's minimal middleware-as-async-functions model                       |

## Stack

- Koa 2 + `@koa/router`
- `laikacms` — FileSystem storage + ContentBase document model
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika` + `minimalBlogConfig`
- A tiny `ctx` ↔ Web `Request`/`Response` adapter (`src/lib/koa-fetch-adapter.ts`)

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-koa-backend dev
```

Then:

- `curl http://localhost:3000/` — endpoint index
- `curl http://localhost:3000/posts` — list published posts
- Open `http://localhost:3000/admin` — Decap CMS admin

## The Koa adapter is the smallest of the three

Koa natively supports setting `ctx.body` to a `Readable` stream — it handles piping to the response
for you. That's one less piece of code than the Express/Fastify versions.

```ts
ctx.body = Readable.fromWeb(webResponse.body as any);
// Koa pipes it to ctx.res, sets Transfer-Encoding, handles backpressure.
```

⚠️ **Do not mount `koa-bodyparser` in front of `/api/decap/*`** — the body parser would drain the
request stream before the adapter forwards it.

## Production hardening

Same checklist as the other starters: real auth, persistent storage, self-hosted Decap shell. See
[`docs/starters.md`](../../docs/starters.md).
