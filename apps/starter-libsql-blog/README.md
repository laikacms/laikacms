# `@laikacms/starter-libsql-blog`

A minimal blog built with [Hono](https://hono.dev) + [LaikaCMS](https://github.com/laikacms/laikacms)
backed by [libSQL / Turso](https://turso.tech). Content is stored in a distributed SQLite table via
the hrana HTTP pipeline protocol. Demonstrates:

- **`createCustomLaika`** — the "BYO storage" pattern: bring any `StorageRepository` implementation
  and wire it into LaikaCMS without being locked to the built-in filesystem preset.
- **`LibSqlStorageRepository`** — stores content in a libSQL/Turso database via `@laikacms/libsql`.
- **`decapAdminHtml`** — generates the entire Decap admin page as a string, so no esbuild step or
  separate admin bundle is required.

## Prerequisites

- Node.js 22.x
- pnpm
- A Turso database **or** a local `sqld` instance

## Getting started

### 1. Build workspace deps first

This starter lives inside the LaikaCMS monorepo. Workspace packages (`laikacms`,
`@laikacms/libsql`, `@laikacms/decap-integrations`) must be compiled before the dev server starts.
Run this once (and again after pulling changes):

```bash
pnpm --filter @laikacms/starter-libsql-blog... build
```

Or from the repo root with Turbo (resolves the full dep graph):

```bash
pnpm turbo build --filter @laikacms/starter-libsql-blog
```

### 2. Set up the database

Run `sql/migration.sql` once to create the `laika_storage` table (or whichever table name you set
via `LIBSQL_TABLE`):

```bash
# Turso
turso db shell <your-db> < apps/starter-libsql-blog/sql/migration.sql

# Local sqld
curl -s -X POST http://localhost:8080/v2/pipeline \
  --data-binary @apps/starter-libsql-blog/sql/migration.sql || \
  sqld-client exec --url http://localhost:8080 < apps/starter-libsql-blog/sql/migration.sql
```

### 3. Configure environment variables

| Variable            | Required | Default          | Description                                                          |
| ------------------- | -------- | ---------------- | -------------------------------------------------------------------- |
| `LIBSQL_URL`        | yes      | —                | Turso URL (`https://<db>-<org>.turso.io`) or `http://localhost:8080` |
| `LIBSQL_AUTH_TOKEN` | no       | _(empty)_        | JWT from the Turso dashboard. Omit when using local `sqld`.          |
| `LIBSQL_TABLE`      | no       | `laika_storage`  | Override the table name.                                             |
| `PORT`              | no       | `3000`           | Port the HTTP server listens on.                                     |

### 4. Run

```bash
cd apps/starter-libsql-blog

# Remote Turso database
LIBSQL_URL=https://<db-name>-<org>.turso.io \
LIBSQL_AUTH_TOKEN=<token> \
pnpm dev

# Local sqld (no auth)
sqld --http-listen-addr 0.0.0.0:8080 &
LIBSQL_URL=http://localhost:8080 pnpm dev
```

## Local development with sqld

`sqld` is the reference libSQL server for local development — no Turso account needed:

```bash
# Install (cargo required)
cargo install sqld

# Start (data stored in ./sqld-data by default)
sqld --http-listen-addr 0.0.0.0:8080

# Run migration
turso db shell http://localhost:8080 < sql/migration.sql
# or paste the SQL manually

# Start the blog
LIBSQL_URL=http://localhost:8080 pnpm dev
```

## URLs

| URL                           | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `http://localhost:PORT/`      | Blog index                                      |
| `http://localhost:PORT/admin/`| Decap CMS admin (no login required in dev mode) |

## Scripts

| Script           | What it does                              |
| ---------------- | ----------------------------------------- |
| `pnpm dev`       | Start server with `tsx` (no watch)        |
| `pnpm start`     | Same as `dev`                             |
| `pnpm typecheck` | TypeScript type-check only (no emit)      |

> **Note:** Unlike `starter-drizzle-sqlite-blog`, this starter does **not** include `predev`/`prestart`
> scripts that auto-build workspace deps. Run the `pnpm --filter ... build` step manually before
> first use (see step 1 above).

## Why this starter exists

Reference for the **BYO storage + libSQL** pattern in the LaikaCMS monorepo. See
[`docs/starters.md`](../../docs/starters.md).
