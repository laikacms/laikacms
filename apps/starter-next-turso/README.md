# `@laikacms/starter-next-turso`

A **Next.js 15** (App Router) blog backed by **Turso** (distributed libSQL). Swaps the embedded
filesystem backend for `createCustomLaika` + `LibSqlStorageRepository` — same server components,
same route structure, cloud-persistent storage deployable to Vercel, Fly.io, Railway, and others.

## Stack

- Next.js 15 (App Router, server components)
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
# Option A: local sqld (no Turso account)
sqld --http-listen-addr 0.0.0.0:8080 &
LIBSQL_URL=http://localhost:8080 pnpm --filter @laikacms/starter-next-turso dev

# Option B: Turso cloud — create .env.local
echo "LIBSQL_URL=https://<db-name>-<org>.turso.io" >> apps/starter-next-turso/.env.local
echo "LIBSQL_AUTH_TOKEN=<your-token>" >> apps/starter-next-turso/.env.local
pnpm --filter @laikacms/starter-next-turso dev
```

Then open:

- `http://localhost:3000/` — blog homepage
- `http://localhost:3000/admin` — Decap CMS admin
- `http://localhost:3000/blog/<slug>` — individual post

## Environment variables

| Variable            | Required | Description                                            |
| ------------------- | -------- | ------------------------------------------------------ |
| `LIBSQL_URL`        | Yes      | Turso DB URL or `http://localhost:8080` for local sqld |
| `LIBSQL_AUTH_TOKEN` | No       | JWT from Turso dashboard; omit for local sqld          |
| `LIBSQL_TABLE`      | No       | Table name override (default: `laika_storage`)         |

## Layout

```
apps/starter-next-turso/
├── tsconfig.json
└── src/
    ├── lib/
    │   ├── decap-config.ts            # collection schema
    │   └── laika.ts                   # createCustomLaika + LibSqlStorageRepository
    └── app/
        ├── layout.tsx                 # root layout
        ├── page.tsx                   # blog homepage (server component)
        ├── blog/[slug]/page.tsx       # post detail (server component)
        ├── admin/
        │   ├── layout.tsx             # admin layout (no nav/padding)
        │   └── page.tsx               # Decap CMS shell (client component)
        └── api/decap/[...path]/
            └── route.ts               # laika.fetch proxy
```
