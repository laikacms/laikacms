# starter-astro-d1

Astro blog deployed to **Cloudflare Pages** backed by **D1 (SQLite)** via
`DrizzleStorageRepository`.

## Key patterns

### D1 binding access in Astro

With `@astrojs/cloudflare`, Cloudflare bindings are **not** available at module load time. They
arrive per-request through `Astro.locals.runtime.env`:

```ts
// src/pages/index.astro — in the frontmatter (---) block
const { DB } = Astro.locals.runtime.env;
const laika = makeLaika(DB);
```

In API routes (`src/pages/api/**/*.ts`) use `context.locals.runtime.env`:

```ts
const handler: APIRoute = ({ request, locals }) => {
  const laika = makeLaika(locals.runtime.env.DB);
  return laika.fetch(request);
};
```

This is different from Node.js runtimes where you can use a module-level singleton.

### Per-request factory

```ts
// src/laika.ts
export function makeLaika(db: D1Database) {
  return createCustomLaika({ storage: makeD1Storage(db), ... });
}
```

`createCustomLaika` is synchronous and cheap — safe to call on every request.

## Setup

1. Create a D1 database:
   ```bash
   wrangler d1 create laikacms-astro-d1
   ```

2. Copy the database ID into `wrangler.toml`:
   ```toml
   [[d1_databases]]
   database_id = "paste-uuid-here"
   ```

3. Run migrations:
   ```bash
   pnpm db:migrate:local   # local dev
   pnpm db:migrate:remote  # production
   ```

4. Start dev server (wrangler provides the D1 binding):
   ```bash
   pnpm dev
   ```

5. Deploy:
   ```bash
   pnpm deploy
   ```

## Routes

| Path           | Description                            |
| -------------- | -------------------------------------- |
| `/`            | Blog post list                         |
| `/blog/:slug`  | Individual post                        |
| `/admin/`      | Decap CMS UI (prerendered static HTML) |
| `/api/decap/*` | LaikaCMS JSON:API (SSR, D1-backed)     |
