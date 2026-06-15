# starter-sveltekit-turso

A blog built with **SvelteKit** and **LaikaCMS** backed by [Turso](https://turso.tech) (libSQL).
Content is stored in a distributed SQLite database; no filesystem access required.

## Stack

- **Framework**: SvelteKit v2 with `@sveltejs/adapter-node`
- **Storage**: Turso (libSQL) via `@laikacms/libsql/storage-libsql`
- **CMS**: Decap Admin from CDN

## Quick start

### 1. Create a Turso database

```bash
turso db create my-blog
turso db show my-blog          # copy URL
turso db tokens create my-blog # copy token

# Run the migration to create the laika_storage table:
turso db shell my-blog < node_modules/@laikacms/libsql/sql/migration.sql
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your LIBSQL_URL and LIBSQL_AUTH_TOKEN
```

### 3. Build workspace dependencies

```bash
pnpm build
```

### 4. Start the dev server

```bash
pnpm dev
```

Open http://localhost:5173/admin to manage content.

## Local development with sqld

```bash
# Run local sqld
sqld --http-listen-addr 0.0.0.0:8080

# Create the table
LIBSQL_URL=http://localhost:8080 turso db shell <name> < node_modules/@laikacms/libsql/sql/migration.sql
# Or use the libsql-local CLI

# Start the dev server
LIBSQL_URL=http://localhost:8080 pnpm dev
```

## Environment variables

| Variable            | Default         | Description                     |
| ------------------- | --------------- | ------------------------------- |
| `LIBSQL_URL`        | _(required)_    | Turso database URL              |
| `LIBSQL_AUTH_TOKEN` | _(optional)_    | JWT token (omit for local sqld) |
| `LIBSQL_TABLE`      | `laika_storage` | Table name override             |

## Key difference from starter-sveltekit-blog

`starter-sveltekit-blog` uses `createEmbeddedLaika` (filesystem). This starter uses
`createCustomLaika` with `LibSqlStorageRepository` — content lives in Turso, not on disk.

SvelteKit loads environment variables via `$env/dynamic/private` (not `process.env`). The laika
singleton in `src/lib/laika.ts` uses `import { env } from '$env/dynamic/private'` which is
SvelteKit's recommended way to read server-side env vars.

## Doc gaps surfaced

1. **SvelteKit env vars via `$env/dynamic/private`** — LaikaCMS docs show `process.env` everywhere.
   SvelteKit enforces its own env access pattern; using `process.env` in SvelteKit works in Node
   mode but misses SvelteKit's validation and Vite's env loading. The recommended import is
   `import { env } from '$env/dynamic/private'`.
2. **`createCustomLaika` module-level initialization** — Initializing `LibSqlDataSource` at module
   level (outside a function) is correct in SvelteKit because server modules are singletons in the
   Node.js process. Docs should note this is the right pattern (vs reinitializing per request).
3. **`decapAdminHtml()` vs SvelteKit `+page.svelte` admin** — `decapAdminHtml()` returns a raw HTML
   string, which can't be used directly in a SvelteKit route (no `c.html()` helper). SvelteKit
   requires a `+page.svelte` that bootstraps Decap via `onMount`, making the CDN pattern slightly
   more verbose than in Hono/Express. Docs should show the SvelteKit-specific admin pattern.
