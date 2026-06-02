# starter-sveltekit-d1

**[SvelteKit](https://kit.svelte.dev/)** blog deployed to
**[Cloudflare Pages](https://pages.cloudflare.com/)** backed by **D1** (Cloudflare's managed SQLite)
via LaikaCMS.

The D1 variant of `starter-sveltekit-turso`. The key architectural difference: D1 bindings are
injected by the Cloudflare runtime at request time as `event.platform.env.DB`, not via
`process.env`. There is no module-level singleton — create a Laika instance per request.

## Key insight: `platform.env` vs `process.env`

In `starter-sveltekit-turso`, a module-level `laika` singleton is safe because Node.js provides
environment variables at startup. On Cloudflare Pages, bindings (D1, KV, R2) arrive per-request via
the runtime:

```ts
// ❌ Doesn't work on Cloudflare Pages
const laika = createCustomLaika({ storage: makeD1Storage(process.env.DB) });

// ✅ Correct: per-request, inside +page.server.ts / +server.ts
export const load: PageServerLoad = ({ platform }) => {
  const laika = makeLaika(platform.env.DB);
  return laika.documents.listRecordSummaries(...);
};
```

## Setup

```bash
# 1. Create a D1 database
wrangler d1 create laikacms-d1
# Copy the database_id into wrangler.toml

# 2. Run the migration
pnpm run db:migrate:local  # local dev
pnpm run db:migrate:remote # Cloudflare

# 3. Start dev server
pnpm dev
```

Visit `http://localhost:5173/admin` to create posts.

## Deploy

```bash
pnpm build
wrangler pages deploy .svelte-kit/cloudflare
```

## Project structure

```
src/
  app.d.ts                          App.Platform type (declares DB: D1Database)
  lib/
    decap-config.ts                 Decap CMS collection definitions
    db.ts                           DrizzleStorageRepository factory for D1
    laika.ts                        makeLaika(db) per-request factory
  routes/
    +page.server.ts                 list posts (platform.env.DB)
    blog/[slug]/+page.server.ts     single post
    api/decap/[...path]/+server.ts  laika.fetch proxy
    admin/+page.svelte              Decap CMS from CDN
migrations/
  0001_create_atoms.sql             D1 table schema
wrangler.toml                       D1 binding configuration
```
