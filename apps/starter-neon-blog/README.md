# starter-neon-blog

A blog built with **Hono** and **LaikaCMS** backed by [Neon](https://neon.tech) serverless Postgres.
Content lives in a Postgres table — the `@neondatabase/serverless` HTTP transport makes it work in
any runtime: Node.js, Cloudflare Workers, Vercel Edge, Deno, Bun.

## Stack

- **Server**: Hono + `@hono/node-server`
- **Storage**: Neon serverless Postgres via `DrizzleStorageRepository`
- **ORM**: Drizzle ORM (`drizzle-orm/neon-http`)
- **CMS**: Decap Admin from CDN

## Quick start

### 1. Create a Neon database

Sign up at https://neon.tech and create a project. Copy the **Connection string** from the dashboard
— it looks like:

```
postgres://user:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your DATABASE_URL
```

### 3. Start the dev server

```bash
pnpm dev
```

The server auto-creates the `atoms` table on first start. Visit http://localhost:3000/admin to
manage content.

## Environment variables

| Variable       | Required | Description                     |
| -------------- | -------- | ------------------------------- |
| `DATABASE_URL` | yes      | Neon Postgres connection string |
| `PORT`         | no       | HTTP port (default: `3000`)     |

## How it works

`DrizzleStorageRepository` is an inversion-of-control storage adapter. You provide:

1. **Query builders** — functions that return Drizzle `SQL` condition objects (`eq`, `like`, `lte`,
   `and`)
2. **CRUD callbacks** — async functions that run Drizzle queries (`insert`, `update`, `delete`,
   `select`)

LaikaCMS handles the storage contract; you own the query layer. The same pattern works with any
Drizzle-supported database: Postgres (Neon, Supabase, PlanetScale, CockroachDB, RDS), SQLite
(libSQL, better-sqlite3, D1), MySQL, etc.

## Doc gaps surfaced

### `@neondatabase/serverless` HTTP transport

Neon's `neon()` function uses HTTP instead of a raw TCP connection. This means it runs in
environments where TCP sockets are unavailable (Cloudflare Workers, Vercel Edge, AWS Lambda@Edge).
Docs should highlight this as the recommended Postgres driver for edge deployments, alongside
`@laikacms/libsql` for SQLite.

### `DrizzleStorageRepository` works with any SQL dialect

The D1 starter and this starter both use `DrizzleStorageRepository` — one with SQLite column types
(`sqliteTable`), one with Postgres (`pgTable`). The IoC interface is identical. Docs should show
this portability explicitly: the same five callbacks work for SQLite, Postgres, and MySQL.

### Schema DDL responsibility

`DrizzleStorageRepository` never runs DDL. The caller must ensure the `atoms` table exists before
use. This starter calls `ensureSchema()` at startup (idempotent `CREATE TABLE IF NOT EXISTS`). Docs
should note this pattern and recommend proper migration tooling (drizzle-kit, flyway) for
production.
