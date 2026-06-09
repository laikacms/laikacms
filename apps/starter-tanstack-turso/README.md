# starter-tanstack-turso

A [TanStack Start](https://tanstack.com/start) blog backed by [Turso](https://turso.tech/) (libSQL
HTTP) via LaikaCMS.

This is the Turso variant of `starter-tanstack-blog`. The only difference is the backend —
`createCustomLaika` + `LibSqlStorageRepository` instead of `createEmbeddedLaika`. Route structure,
`createServerFn` patterns, and the Decap CMS admin are identical.

## How it works

```
src/laika.ts              server-only singleton (import 'server-only')
src/routes/api/decap/$.ts ANY handler → laika.fetch(request)
src/routes/index.tsx      createServerFn → laika.documents.listRecordSummaries
src/routes/blog.$slug.tsx createServerFn → laika.documents.getDocument
src/routes/admin.tsx      Decap CMS from CDN + laika backend (client-only)
```

The `import '@tanstack/react-start/server-only'` guard in `src/laika.ts` causes Vite to hard-error
if anything tries to import it from a client bundle. The libSQL data source speaks the Hrana HTTP
protocol directly (`globalThis.fetch`), so no Node.js-specific APIs are needed.

## Setup

```bash
cp .env.example .env   # add LIBSQL_URL and LIBSQL_AUTH_TOKEN
pnpm install
pnpm dev
```

Visit `http://localhost:3000/admin` to create posts.

## Environment variables

| Variable            | Description                                   | Default         |
| ------------------- | --------------------------------------------- | --------------- |
| `LIBSQL_URL`        | Turso database URL or `http://localhost:8080` | —               |
| `LIBSQL_AUTH_TOKEN` | Turso JWT (omit for local sqld)               | —               |
| `LIBSQL_TABLE`      | Table name for LaikaCMS storage               | `laika_storage` |

## Local sqld

```bash
docker run -p 8080:8080 ghcr.io/tursodatabase/sqld:latest
LIBSQL_URL=http://localhost:8080 pnpm dev
```
