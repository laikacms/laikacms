# starter-workers-d1

A blog running on **Cloudflare Workers** with **D1** (Cloudflare's managed SQLite) as the content
store, backed by **LaikaCMS** via `createCustomLaika` + `DrizzleStorageRepository`.

## Why D1 vs R2?

| Dimension | R2 (object storage) | D1 (SQLite) |
|-----------|--------------------|--------------------|
| Query | Key/prefix scan | Full SQL — `WHERE`, `ORDER BY`, range filters |
| Cost | ~$0.015/GB/month | Free tier: 5 GB + 25 M row reads/day |
| Best for | Large blobs, media | Structured content, fast reads |

For a blog with hundreds of posts, D1's indexed queries are faster and cheaper than R2 prefix scans.

## Quick start (local)

```bash
pnpm install

# Create the atoms table in the local D1 mock
pnpm run db:migrate:local

# Start the dev server
pnpm dev
```

Open **http://localhost:3000** for the blog and **http://localhost:3000/admin** for the CMS.

## Deploy to Cloudflare

```bash
# 1. Create the database and copy its ID into wrangler.toml
wrangler d1 create laikacms-d1

# 2. Run the migration remotely
pnpm run db:migrate:remote

# 3. Deploy the Worker
pnpm deploy
```

## Architecture

```
Cloudflare Workers runtime
  └─ Hono router
       ├─ GET  /admin          decapAdminHtml() — CDN-loaded Decap CMS shell
       ├─ ALL  /api/decap/*    laika.fetch (Decap JSON:API)
       ├─ GET  /               blog home (listRecordSummaries)
       └─ GET  /blog/:slug     single post (getDocument)

Storage:
  D1Database (env.DB)
    └─ drizzle(d1) → DrizzleStorageRepository → createCustomLaika
```

## Key patterns

### Per-request Laika instance

D1 bindings are scoped to the incoming request. `createCustomLaika` is a cheap synchronous factory
(just a few object allocations), so it's safe to call on every request:

```ts
function makeLaika(env: Env) {
  return createCustomLaika({
    storage: makeD1Storage(env.DB),
    decapConfig,
    basePath: '/api/decap',
    auth: { mode: 'dev' },
    seedConfigOnFirstRequest: true,  // writes config.yml to D1 on first request
  });
}
app.all('/api/decap/*', c => makeLaika(c.env).fetch(c.req.raw));
```

### DrizzleStorageRepository over D1

The `DrizzleStorageRepository` from `laikacms/storage-drizzle` is driver-agnostic. Swap the
`drizzle(d1)` call for `drizzle(libsqlClient)` and the same schema and callbacks work over libsql,
Turso, or any SQLite-compatible database.

```ts
import { drizzle } from 'drizzle-orm/d1';
const db = drizzle(env.DB);
```
