# `@laikacms/starter-trpc`

LaikaCMS exposed as a **tRPC v11** API via `@hono/trpc-server`. End-to-end type safety — the client
imports `AppRouter` and gets typed procedures with zero codegen.

Sibling to `apps/starter-graphql`: both expose the same `posts.list / get / createDraft /
publish`
surface, but tRPC speaks to typed TypeScript clients while GraphQL speaks to any GraphQL client.
Pick the one your frontend already uses.

## Stack

- Hono + `@hono/node-server`
- `@trpc/server` v11 + Zod input schemas
- `@hono/trpc-server` adapter (Request/Response ↔ tRPC)
- `laikacms` + `@laikacms/decap-integrations/embedded`

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-trpc dev
```

Then:

- `http://localhost:3000/trpc/posts.list` — direct tRPC HTTP endpoint
- `http://localhost:3000/admin` — Decap CMS admin (JSON:API)
- `http://localhost:3000/api/decap/*` — JSON:API

## Procedures

| Procedure           | Type     | Input                                           | Output          |
| ------------------- | -------- | ----------------------------------------------- | --------------- |
| `posts.list`        | query    | `{ folder?: string, limit?: number }`           | `PostSummary[]` |
| `posts.get`         | query    | `{ slug: string }`                              | `Post \| null`  |
| `posts.createDraft` | mutation | `{ slug: string, title: string, body: string }` | `Draft`         |
| `posts.publish`     | mutation | `{ slug: string }`                              | `Post`          |

## Client usage

```ts
import type { AppRouter } from '@laikacms/starter-trpc/src/router';
import { createTRPCClient, httpBatchLink } from '@trpc/client';

const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: 'http://localhost:3000/trpc' })],
});

// Fully typed — IDE autocomplete + TS errors if you misspell anything.
const posts = await trpc.posts.list.query({ folder: 'posts', limit: 5 });
const post = await trpc.posts.get.query({ slug: 'hello-world' });
const draft = await trpc.posts.createDraft.mutate({
  slug: 'new-post',
  title: 'Hello',
  body: 'World',
});
await trpc.posts.publish.mutate({ slug: 'new-post' });
```

> In a real project, you'd import `AppRouter` as a `type` (with `import type`) so the actual tRPC
> server bundle never ships to the browser.

## tRPC vs. GraphQL — which to pick?

| Concern        | tRPC                        | GraphQL                      |
| -------------- | --------------------------- | ---------------------------- |
| Client         | TypeScript only             | Any language                 |
| Types          | Inferred from resolver code | Defined via SDL              |
| Codegen        | Zero (TS does it)           | Sometimes (varies by client) |
| Query language | Procedure name + args       | Full GraphQL query           |
| Federation     | Not built-in                | Built-in                     |
| Discovery      | IDE autocomplete            | Schema introspection         |

Both starters in this repo wrap the same `laika.documents.*` repo. The repo is the source of truth;
the API surface is taste.

## Production hardening

- Wrap procedures in middleware that authenticates the request (Bearer token, session cookie, etc.).
  tRPC's `t.middleware` is the right shape.
- Use `zod`'s `.transform()` to coerce dates, slugs, etc. cleanly.
- For batched requests with `httpBatchLink`, set sensible query timeouts on the server.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
