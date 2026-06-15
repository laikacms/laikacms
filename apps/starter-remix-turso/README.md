# `@laikacms/starter-remix-turso`

A **Remix** blog backed by **Turso** (distributed libSQL). Swaps the embedded filesystem backend for
`createCustomLaika` + `LibSqlStorageRepository` — same routes, same loader pattern, cloud-persistent
storage accessible from any deployment (Fly.io, Render, Railway, etc.).

## Stack

- Remix v2 (Vite preset)
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
# Point at a local sqld instance (no auth token needed):
sqld --http-listen-addr 0.0.0.0:8080 &

LIBSQL_URL=http://localhost:8080 pnpm --filter @laikacms/starter-remix-turso dev
```

Or create a `.env` file for Turso cloud:

```env
LIBSQL_URL=https://<db-name>-<org>.turso.io
LIBSQL_AUTH_TOKEN=<your-token>
```

Then:

```bash
pnpm --filter @laikacms/starter-remix-turso dev
```

Open:

- `http://localhost:5173/` — blog homepage
- `http://localhost:5173/admin` — Decap CMS admin
- `http://localhost:5173/blog/<slug>` — individual post

## Environment variables

| Variable            | Required | Description                                            |
| ------------------- | -------- | ------------------------------------------------------ |
| `LIBSQL_URL`        | Yes      | Turso DB URL or `http://localhost:8080` for local sqld |
| `LIBSQL_AUTH_TOKEN` | No       | JWT from Turso dashboard; omit for local sqld          |
| `LIBSQL_TABLE`      | No       | Table name override (default: `laika_storage`)         |

## Compared to `starter-remix-blog`

|                 | `starter-remix-blog`           | `starter-remix-turso`      |
| --------------- | ------------------------------ | -------------------------- |
| Storage         | Local filesystem (`./content`) | Turso (distributed libSQL) |
| Factory         | `createEmbeddedLaika`          | `createCustomLaika`        |
| Dev requires    | Nothing                        | `sqld` or Turso account    |
| Deploy anywhere | Only with persistent volume    | Yes — any Node.js host     |

## Layout

```
apps/starter-remix-turso/
├── vite.config.ts
├── tsconfig.json
└── app/
    ├── root.tsx
    ├── lib/
    │   ├── decap-config.ts    # collection schema
    │   └── laika.server.ts    # createCustomLaika + LibSqlStorageRepository
    └── routes/
        ├── _blog.tsx          # layout for blog pages
        ├── _blog._index.tsx   # homepage — listRecordSummaries loader
        ├── _blog.blog.$slug.tsx  # post page — getDocument loader
        ├── admin.tsx          # Decap CMS shell (client-only, useEffect)
        └── api.decap.$.tsx    # laika.fetch proxy
```
