# `@laikacms/starter-hono-rpc`

LaikaCMS exposed via **Hono's built-in typed client** (`hc`). The same Hono routes you'd write
anyway double as a typed RPC schema — no separate procedure declarations like tRPC, no SDL like
GraphQL. The client gets every route's input/output shape from `typeof app`.

Third typed-API surface in this repo, after `starter-trpc` and `starter-graphql`. Pick whichever
fits your team's existing ecosystem; all three wrap the same `laika.documents.*` repos.

## Stack

- Hono + `@hono/node-server`
- `@hono/zod-validator` for input validation
- `laikacms` + `@laikacms/decap-integrations/embedded`

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-hono-rpc dev
```

Then:

- `curl http://localhost:3000/rpc/posts` — list posts
- `curl http://localhost:3000/rpc/posts/hello-world` — single post
- `curl -X POST -H "Content-Type: application/json" -d '{"slug":"foo","title":"Foo","body":"Hello"}' http://localhost:3000/rpc/posts`
  — create draft
- `curl -X POST http://localhost:3000/rpc/posts/foo/publish` — publish

## Client usage

```ts
import type { AppType } from '@laikacms/starter-hono-rpc/src/server';
import { hc } from 'hono/client';

const client = hc<AppType>('http://localhost:3000');

// Fully typed:
const res = await client.rpc.posts.$get();
const { posts } = await res.json();

const post = await client.rpc.posts[':slug'].$get({ param: { slug: 'hello-world' } });

await client.rpc.posts.$post({
  json: { slug: 'new-post', title: 'New!', body: 'Hello' },
});
```

> Import `AppType` as a `type` (`import type ...`) so the server bundle never ships to the browser.

## Hono RPC vs tRPC vs GraphQL

| Concern         | Hono RPC                | tRPC                            | GraphQL                      |
| --------------- | ----------------------- | ------------------------------- | ---------------------------- |
| Schema source   | Hono route declarations | Procedure declarations          | SDL (.graphql) or code-first |
| Client lib      | `hono/client.hc`        | `@trpc/client`                  | Apollo / urql / Relay        |
| Server overhead | Zero — it's just Hono   | Adds `@trpc/server` runtime     | Adds graphql-yoga + executor |
| Type derivation | `typeof app`            | `typeof appRouter`              | Codegen or built-in helpers  |
| Wire format     | Plain REST-ish JSON     | tRPC-specific batching protocol | GraphQL JSON                 |
| Streaming/subs  | SSE via `streamSSE`     | Built-in subscriptions          | Yoga's SSE subscriptions     |
| Discovery       | IDE only                | IDE only                        | Introspection + tooling      |

The right pick depends on what your frontend already speaks. All three call the same
`laika.documents.*` repo — the repo is the source of truth.

## Production hardening

- Wrap routes in Hono middleware for auth (`bearerAuth`, custom JWT, session cookies).
- Use `@hono/zod-validator`'s error hooks to return consistent error shapes.
- For high-throughput endpoints, prefer raw `c.req.json()` over `zValidator` to skip the schema on
  the hot path (and validate later if needed).

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
