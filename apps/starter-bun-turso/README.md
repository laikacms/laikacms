# starter-bun-turso

Blog on **[Bun](https://bun.sh)'s** native HTTP server backed by [Turso](https://turso.tech/)
(libSQL HTTP) via LaikaCMS.

The Turso variant of `starter-bun-blog`. Swap `createEmbeddedLaika` (filesystem) for
`createCustomLaika` + `LibSqlStorageRepository` — the `Bun.serve()` and routing patterns are
identical.

## Why Bun + Turso is clean

- `Bun.serve()` receives a WHATWG `Request` and returns a `Response` — zero adaptation needed to
  call `laika.fetch(request)`.
- `LibSqlDataSource` speaks the Hrana HTTP protocol via `globalThis.fetch`. Bun's built-in fetch is
  fully WHATWG-compliant, so no `nodejs_compat` or polyfills are required.
- No separate build step: `bun --watch src/server.ts` runs TypeScript directly.

## Setup

```bash
cp .env.example .env   # add LIBSQL_URL and LIBSQL_AUTH_TOKEN
bun install
bun --watch src/server.ts
```

Visit `http://localhost:3000/admin` to create posts via Decap CMS.

## Environment variables

| Variable            | Description                                   | Default         |
| ------------------- | --------------------------------------------- | --------------- |
| `LIBSQL_URL`        | Turso URL or `http://localhost:8080` for sqld | —               |
| `LIBSQL_AUTH_TOKEN` | Turso JWT (omit for local sqld)               | —               |
| `LIBSQL_TABLE`      | Table name for LaikaCMS storage               | `laika_storage` |
| `PORT`              | HTTP port                                     | `3000`          |

## Local sqld

```bash
docker run -p 8080:8080 ghcr.io/tursodatabase/sqld:latest
LIBSQL_URL=http://localhost:8080 bun src/server.ts
```
