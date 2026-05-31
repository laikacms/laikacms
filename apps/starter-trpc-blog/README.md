# starter-trpc-blog

Starter blog exposing LaikaCMS content through a [tRPC](https://trpc.io/) API served by
[Hono](https://hono.dev/).

## What this demonstrates

- **tRPC procedures over `laika.documents.*`**: `posts` query uses `collectStream`, `post` query
  uses `runTask` — the same `laikacms/compat` API as all other starters, now behind type-safe tRPC
  procedures.
- **Zod output schemas as the typing bridge**: `doc.content` is `Record<string, unknown>`. tRPC's
  `.output()` requires a Zod schema; defining `PostSchema` with Zod gives both runtime validation
  and TypeScript inference. The Zod schema effectively acts as a typed adapter between the untyped
  CMS content and the rest of the application.
- **Doc gap: no Zod schema derivation from Decap collections**: You must manually mirror the field
  names from `decap-config.ts` into the Zod schema. A future `zodSchemaFromCollection(collection)`
  helper would eliminate this duplication (see `src/router.ts`).
- **No `IncomingMessage` bridge**: Hono, `@hono/trpc-server`, and `laika.fetch` all use the WHATWG
  Fetch API — no adapter needed.

## Getting started

```bash
pnpm install
pnpm dev   # http://localhost:3000
```

Open `/admin/` to add content, then query the tRPC endpoint:

```bash
# List posts
curl 'http://localhost:3000/trpc/posts'

# Get a post by slug
curl 'http://localhost:3000/trpc/post?input=%7B%22slug%22%3A%22hello-world%22%7D'
```

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
  router.ts       ← tRPC router: procedures + Zod schemas (laika.documents.* → tRPC)
  admin-client.ts ← browser bundle: registers laika backend with Decap
  server.ts       ← Hono: /trpc/* + /api/decap/* + HTML blog + static files
public/admin/     ← Decap CMS admin UI (index.html + bundle.js)
content/          ← markdown files managed by LaikaCMS
```

## Known ergonomics gap

`Document.content` (`Record<string, unknown>`) must be described again as a Zod schema to use it
safely with tRPC. There is currently no way to generate this Zod schema from the Decap collection
definition automatically:

```ts
// What you have to write today:
const PostSchema = z.object({ title: z.string().optional(), body: z.string().optional() });

// What would eliminate the duplication:
const PostSchema = zodSchemaFromCollection(blogCollections[0]); // doesn't exist yet
```
