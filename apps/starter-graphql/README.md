# `@laikacms/starter-graphql`

LaikaCMS exposed as a **GraphQL API** via [graphql-yoga](https://the-guild.dev/graphql/yoga-server).
The JSON:API stays mounted alongside — they're not mutually exclusive. Editors keep using JSON:API
(that's what Decap speaks); read-side consumers can use GraphQL.

Use this starter when:

- Your frontend already uses GraphQL (Apollo Client, urql, Relay) and you want LaikaCMS to fit in
  without a translation layer.
- You want a typed read API surface — the schema is generated from `src/schema.ts`.
- You want federation potential later: this can be a subgraph in a federated graph.

## Stack

- Hono + `@hono/node-server` (host)
- graphql-yoga (GraphQL server + GraphiQL playground)
- `laikacms` + `@laikacms/decap-integrations/embedded` (same repos as every other starter)

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-graphql dev
```

Then:

- `http://localhost:3000/graphql` — **GraphiQL** playground in the browser (try the sample queries
  below).
- `http://localhost:3000/admin` — Decap CMS admin (writes via JSON:API).
- `http://localhost:3000/api/decap/*` — JSON:API (also still available).

## Sample queries

```graphql
# List published posts
query {
  posts(folder: "posts", limit: 10) {
    slug
    title
    date
  }
}

# Read a single post
query {
  post(slug: "hello-world") {
    title
    body
    date
    content
  }
}

# Create a draft (mutation)
mutation {
  createDraft(slug: "my-first-post", title: "Hello!", body: "Hello, world.") {
    slug
    status
  }
}

# Publish a draft
mutation {
  publish(slug: "my-first-post") {
    slug
    title
  }
}
```

## How it works

`src/schema.ts` defines the SDL and resolvers. Resolvers call `laika.documents.*` directly via
`runTask` / `collectStream` from `laikacms/compat` — same direct-repo pattern as every other
starter, just expressed as GraphQL resolvers instead of HTTP handlers.

The schema is intentionally tiny — Post + Draft + queries + 2 mutations — to keep the starter
readable. Real applications would add:

- Pagination (`Edge` + `PageInfo` style).
- Filtering (`postsWhere(...)` arg).
- Subscriptions (graphql-yoga supports SSE-based subscriptions out of the box — pair with a pub-sub
  layer when LaikaCMS gets one).
- DataLoader for batching repeated reads.

## Why two API surfaces?

JSON:API is **what Decap speaks**. GraphQL is **what your frontend prefers**. Mounting both lets
each side use what's natural without an adapter. ADR-002 in the repo proposes this; this starter
makes it concrete.

## Production hardening

- Authenticate GraphQL requests separately from `/api/decap/*` — they have different threat models.
  Use yoga's `context` to inject your auth result.
- Validate / cap query complexity to avoid DoS via expensive queries
  (`@graphql-tools/utils.queryComplexity`).
- Cache reads at the resolver level once you wire LaikaCMS subscriptions in.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
