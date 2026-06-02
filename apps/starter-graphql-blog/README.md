# starter-graphql-blog

Starter blog exposing LaikaCMS content through a GraphQL API using
[GraphQL Yoga](https://the-guild.dev/graphql/yoga-server) + [Hono](https://hono.dev/).

## What this demonstrates

- **GraphQL resolvers over `laika.documents.*`**: `Query.posts` uses `collectStream`, `Query.post`
  uses `runTask` — the same API as SSR starters, wrapped in GraphQL resolvers.
- **`doc.content` type-casting**: `laika.documents.getDocument` returns `Document` where
  `content: Record<string, unknown>`. GraphQL resolvers must cast this to the collection-specific
  interface. There is no compile-time connection between the Decap collection schema and TypeScript
  types — this is a known ergonomics gap (see `src/schema.ts`).
- **No `IncomingMessage` bridge**: Both Hono and GraphQL Yoga speak the WHATWG Fetch
  `Request`/`Response` API natively. `laika.fetch` also accepts a WHATWG `Request`, so the entire
  stack is adapter-free. Contrast with Express/Fastify/node:http starters that need a
  `toLaikaRequest` helper.
- **GraphQL Yoga + Hono integration**: `yoga.handle(c.req.raw, c)` — GraphQL Yoga's handler takes a
  raw `Request` and returns a `Response`.

## Getting started

```bash
pnpm install
pnpm dev   # http://localhost:3000
```

Open `/admin/` to add content, then try the GraphQL endpoint:

```bash
curl -X POST http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ posts { slug updatedAt } }"}'
```

Or open `http://localhost:3000/graphql` in a browser to use GraphQL Yoga's built-in GraphiQL
playground.

## Scripts

| Script           | Description                                       |
| ---------------- | ------------------------------------------------- |
| `pnpm dev`       | Build admin bundle + start server with hot reload |
| `pnpm start`     | Start server (no hot reload)                      |
| `pnpm typecheck` | TypeScript type-check `src/`                      |

## Architecture

```
src/
  laika.ts        ← createEmbeddedLaika singleton
  decap-config.ts ← Decap CMS collection definitions
  schema.ts       ← GraphQL schema + resolvers (laika.documents.* → GraphQL)
  admin-client.ts ← browser bundle: registers laika backend with Decap
  server.ts       ← Hono: /graphql + /api/decap/* + HTML blog + static files
public/admin/     ← Decap CMS admin UI (index.html + bundle.js)
content/          ← markdown files managed by LaikaCMS
```

## Known ergonomics gap

`doc.content` is typed as `Record<string, unknown>` regardless of which collection the document
belongs to. When writing GraphQL resolvers (or any typed consumer) you must define a local interface
and cast:

```ts
interface PostContent {
  title?: string;
  date?: string;
  body?: string;
}
const { title, body } = doc.content as PostContent;
```

A future LaikaCMS improvement would let you parameterise the content type:
`getDocument<PostContent>(key)` — so the cast would be unnecessary.
