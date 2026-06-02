# starter-bun-sqlite

A blog built with **Hono** on **Bun** and **LaikaCMS** backed by Bun's native SQLite (`bun:sqlite`).
Zero external database dependencies — SQLite is built into the Bun runtime.

## Stack

- **Runtime**: Bun ≥ 1.1
- **Server**: Hono (exported as `default.fetch` for `Bun.serve`)
- **Storage**: `bun:sqlite` (native) via `DrizzleStorageRepository` + `drizzle-orm/bun-sqlite`
- **CMS**: Decap Admin from CDN

## Quick start

```bash
bun dev
```

The server creates `laikacms.db` in the project directory on first start. Visit
http://localhost:3000/admin to manage content.

## Environment variables

| Variable  | Default         | Description      |
| --------- | --------------- | ---------------- |
| `DB_PATH` | `./laikacms.db` | SQLite file path |
| `PORT`    | `3000`          | HTTP port        |

## How it works

Hono exported as `default { fetch }` is the native `Bun.serve` integration pattern — Bun picks up
the default export automatically when you run `bun src/index.ts`. No `@hono/node-server` needed; the
WHATWG `Request`/`Response` interface is native.

`DrizzleStorageRepository` (IoC) handles the LaikaCMS storage contract. You provide query builders
and CRUD callbacks; Bun's synchronous SQLite is wrapped by Drizzle in an async interface.

## Doc gaps surfaced

### Bun's native SQLite needs no npm package

`bun:sqlite` is built into Bun — no `better-sqlite3` or `@libsql/client` needed. Docs show
`createEmbeddedLaika` for filesystem or `@laikacms/libsql` for libSQL, but the DrizzleORM pattern
works directly with Bun's SQLite via `drizzle-orm/bun-sqlite`. This is zero-install SQLite for Bun
projects.

### Hono default export for Bun

Hono apps export `{ fetch }` as `export default` for Bun's native serve — this is different from
`@hono/node-server` which wraps `app.fetch` in Node's `http.createServer`. Docs should call out the
Bun export pattern explicitly.

### `bun:sqlite` is synchronous but Drizzle wraps async

Bun's SQLite API is synchronous (same-thread, no IPC). Drizzle wraps it in Promise-returning
methods, so it integrates with LaikaCMS's async storage interface without any extra bridging. This
means setup is also synchronous — no `await createBunSqliteStorage(...)`.
