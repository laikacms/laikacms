# starter-nuxt-d1

Nuxt 3 blog deployed to **Cloudflare Pages** backed by **D1 (SQLite)** via
`DrizzleStorageRepository`.

## Key patterns

### D1 binding access in Nuxt / Nitro

With Nitro's `cloudflare-pages` preset the D1 binding is available per-request via
`event.context.cloudflare.env.DB`. There is no `process.env.DB`:

```ts
// server/api/posts.get.ts
export default defineEventHandler(async event => {
  const { DB } = event.context.cloudflare.env;
  const laika = makeLaika(DB);
  // ...
});
```

This is different from the Turso-backed starter where a module-level singleton works because Turso
only needs `fetch()` (always available), whereas D1 is only available inside a Cloudflare request
context.

### Per-request factory

```ts
// server/utils/laika.ts
export function makeLaika(db: D1Database) {
  return createCustomLaika({ storage: makeD1Storage(db), ... });
}
```

### TypeScript: extend h3's H3EventContext

Declare `event.context.cloudflare.env` in `server/cloudflare-env.d.ts`:

```ts
declare module 'h3' {
  interface H3EventContext {
    cloudflare: { env: CloudflareEnv, context: { waitUntil(p: Promise<unknown>): void } };
  }
}
interface CloudflareEnv {
  DB: D1Database;
}
```

## Setup

1. Create a D1 database:
   ```bash
   wrangler d1 create laikacms-nuxt-d1
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

4. Start dev server:
   ```bash
   pnpm dev
   ```

5. Deploy:
   ```bash
   pnpm deploy
   ```

## Routes

| Path               | Description                        |
| ------------------ | ---------------------------------- |
| `/`                | Blog post list                     |
| `/blog/:slug`      | Individual post                    |
| `/admin`           | Decap CMS UI (client-side only)    |
| `/api/decap/[…]`   | LaikaCMS JSON:API (SSR, D1-backed) |
| `/api/posts`       | Post list API                      |
| `/api/posts/:slug` | Single post API                    |
