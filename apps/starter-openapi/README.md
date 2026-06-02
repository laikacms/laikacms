# `@laikacms/starter-openapi`

Typed REST API with **auto-generated OpenAPI 3.1 spec** + a beautiful interactive
**[Scalar](https://scalar.com)** API reference. Hono + `@hono/zod-openapi`. Backend devs and
external consumers get browsable, try-it-now docs without writing any docs.

## Stack

- Hono + `@hono/node-server`
- `@hono/zod-openapi` — route definitions with Zod schemas in TypeScript become OpenAPI spec
- `@scalar/hono-api-reference` — the docs UI
- `laikacms` + `@laikacms/decap-integrations/embedded`

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-openapi dev
```

Then:

- `http://localhost:3000/docs` — **Scalar UI** (browsable, executable API reference)
- `http://localhost:3000/openapi.json` — raw OpenAPI 3.1 spec (feed to client codegen)
- `http://localhost:3000/admin` — Decap CMS admin
- `http://localhost:3000/posts` — JSON list endpoint (same one in the docs)

## What you get for free

Define a route with Zod schemas in TypeScript:

```ts
const listPostsRoute = createRoute({
  method: 'get',
  path: '/posts',
  request: {
    query: z.object({ folder: z.string().default('posts'), limit: z.coerce.number().default(100) }),
  },
  responses: {
    200: {
      description: 'Published posts in the given folder.',
      content: { 'application/json': { schema: z.object({ posts: z.array(PostSummarySchema) }) } },
    },
  },
});
```

And out the other side:

1. **Runtime validation** of request inputs (Zod rejects bad input).
2. **Static types** for the handler's `c.req.valid('query')` / `c.json(...)` — narrow types, not
   `any`.
3. **OpenAPI 3.1 JSON** at `/openapi.json`, generated from the same schemas.
4. **Interactive docs** at `/docs` — try-it-now buttons, request/response examples.

One source of truth, three outputs (types + validation + docs).

## OpenAPI vs the other typed-API starters

| Surface                  | Codegen  | Spec source      | Client-language support       |
| ------------------------ | -------- | ---------------- | ----------------------------- |
| `starter-trpc`           | none     | typeof appRouter | TypeScript only               |
| `starter-graphql`        | varies   | SDL              | Any (Apollo, urql, Relay)     |
| `starter-hono-rpc`       | none     | typeof app       | TypeScript only               |
| `starter-openapi` (this) | optional | OpenAPI 3.1      | Any (orval, openapi-ts, etc.) |
| `starter-mcp-server`     | none     | MCP tool list    | AI agents                     |

OpenAPI is the format you'd want if your consumers might not all speak TypeScript — Python / Go /
Java / Swift / Kotlin all have mature OpenAPI client generators.

## Production hardening

- Add `bearerAuth` security scheme to `app.doc(...)` — Scalar shows the auth header field once
  declared.
- Use `app.openAPIRegistry.registerComponent('securitySchemes', ...)` to wire JWT/OAuth into the
  spec.
- Lock down `/docs` + `/openapi.json` behind a CORS / auth check if your API isn't public.
- Bake schemas into a versioned client SDK with
  [`openapi-typescript`](https://github.com/drwpow/openapi-typescript) or
  [`orval`](https://orval.dev/).

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
