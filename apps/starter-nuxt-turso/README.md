# `@laikacms/starter-nuxt-turso`

A **Nuxt 3** blog backed by **Turso** (distributed libSQL). Swaps the embedded filesystem backend
for `createCustomLaika` + `LibSqlStorageRepository` — same Nitro API routes, same `useFetch` pages,
cloud-persistent storage.

## Stack

- Nuxt 3 (Nitro + Vue 3)
- `@laikacms/libsql` — `LibSqlDataSource` + `LibSqlStorageRepository`
- `@laikacms/decap-integrations/custom` — `createCustomLaika`
- Turso / libSQL HTTP endpoint

## Quick start

First build workspace dependencies:

```bash
pnpm build
```

Then:

```bash
# Option A: local sqld (no Turso account needed)
sqld --http-listen-addr 0.0.0.0:8080 &
LIBSQL_URL=http://localhost:8080 pnpm --filter @laikacms/starter-nuxt-turso dev

# Option B: Turso cloud — create .env
echo "LIBSQL_URL=https://<db-name>-<org>.turso.io" >> apps/starter-nuxt-turso/.env
echo "LIBSQL_AUTH_TOKEN=<your-token>" >> apps/starter-nuxt-turso/.env
pnpm --filter @laikacms/starter-nuxt-turso dev
```

Open:

- `http://localhost:3000/` — blog homepage
- `http://localhost:3000/admin` — Decap CMS admin (client-side only via `routeRules`)
- `http://localhost:3000/blog/<slug>` — individual post

## Environment variables

| Variable            | Required | Description                                            |
| ------------------- | -------- | ------------------------------------------------------ |
| `LIBSQL_URL`        | Yes      | Turso DB URL or `http://localhost:8080` for local sqld |
| `LIBSQL_AUTH_TOKEN` | No       | JWT from Turso dashboard; omit for local sqld          |
| `LIBSQL_TABLE`      | No       | Table name override (default: `laika_storage`)         |

## Layout

```
apps/starter-nuxt-turso/
├── nuxt.config.ts                          # ssr: false for /admin
├── utils/
│   └── decap-config.ts                     # shared collection schema
├── layouts/
│   └── default.vue                         # page wrapper
├── pages/
│   ├── index.vue                           # blog list (useFetch /api/posts)
│   ├── blog/[slug].vue                     # post detail (useFetch /api/posts/:slug)
│   └── admin.vue                           # Decap CMS shell (onMounted, CSR only)
└── server/
    ├── utils/laika.ts                      # createCustomLaika + LibSqlStorageRepository
    └── api/
        ├── decap/[...path].ts              # laika.fetch proxy via toWebRequest
        ├── posts.get.ts                    # list published posts
        └── posts/[slug].get.ts             # single post
```
