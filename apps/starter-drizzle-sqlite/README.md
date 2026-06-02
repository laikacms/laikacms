# `@laikacms/starter-drizzle-sqlite`

LaikaCMS with **SQL storage** — `DrizzleStorageRepository` over libsql/SQLite. The first starter to
exercise the `laikacms/storage-drizzle` backend, complementing the FileSystem (Node) and R2
(Workers) starters.

Use this starter when you want:

- **Self-hosted production** without managing a filesystem volume.
- **Atomic transactional writes** via SQL.
- A path to **Turso / Postgres / MySQL** later — change one import.

## Stack

- Hono + `@hono/node-server`
- libsql client (single-process SQLite by default; Turso-ready)
- Drizzle ORM (schema + query builders)
- `laikacms/storage-drizzle` — `DrizzleStorageRepository`
- `@laikacms/decap-integrations` — `decapApi`, `decapAdminHtml`, `minimalBlogConfig`

> ⚠ This starter does NOT use `createEmbeddedLaika`. The embedded preset is wired for the FS path;
> DrizzleStorageRepository's IoC API (queryBuilders + callbacks) is different enough that the
> starter wires the full stack by hand. See `src/server.ts` for the canonical shape.

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-drizzle-sqlite dev
```

By default content lands in `./laikacms.db` (gitignored). Override with `DB_URL=...` — set it to a
`libsql://...` URL to point at Turso instead.

Then:

- `curl http://localhost:3000/` — endpoint index
- `curl http://localhost:3000/posts` — list published posts
- Open `http://localhost:3000/admin` — Decap CMS admin

## The IoC pattern

`DrizzleStorageRepository` doesn't know about your schema. You hand it:

1. **`queryBuilders`** — functions that build WHERE-clauses for the four primitive predicates (key
   equals, key starts-with, depth ≤ N, AND-combinator).
2. **`callbacks`** — `insert` / `update` / `delete` / `select` against your actual table.

This means the same `DrizzleStorageRepository` works with **any SQL dialect Drizzle supports**:
SQLite (this starter), Postgres, MySQL, Turso, Cloudflare D1, Neon, etc. Swap the schema + client;
the rest is identical.

See `src/db/repo.ts` for the wiring (~50 lines). The schema is in `src/db/schema.ts` (10 lines).

## Why no `createEmbeddedLaika`?

`createEmbeddedLaika` is a one-call preset specifically over FileSystem. The Drizzle path needs
async setup (table creation), a custom schema, and the IoC wiring above — none of which fit the
preset shape. A future `createSqlLaika({ db, dialect, schema })` preset could compress this; for
now, the starter shows the explicit wiring.

## Production hardening

Same checklist as the other starters: real auth, persistent DB (mounted disk for SQLite or a managed
service like Turso), self-hosted Decap shell.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
