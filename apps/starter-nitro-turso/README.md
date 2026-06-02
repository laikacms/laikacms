# starter-nitro-turso

**[Nitro](https://nitro.unjs.io/)** universal server blog backed by [Turso](https://turso.tech/)
(libSQL) via LaikaCMS.

Nitro deploys to Node.js, Cloudflare Workers, Vercel, Netlify, and more with a single codebase. This
starter uses Turso as the storage layer so content is portable across all Nitro deployment targets.

## How it works

```
server/utils/laika.ts          module-level singleton (Nitro auto-import)
server/routes/api/decap/[...].ts  toWebRequest(event) → laika.fetch
server/routes/index.ts         list posts
server/routes/blog/[slug].ts   single post
server/routes/admin.ts         Decap CMS from CDN
```

`toWebRequest(event)` (from `h3`) converts the H3/Nitro event to a WHATWG `Request` so
`laika.fetch()` can consume it directly. Nitro accepts a WHATWG `Response` return value — no
`sendWebResponse` wrapper needed.

## Setup

```bash
cp .env.example .env   # add LIBSQL_URL
pnpm install
pnpm dev
```

Visit `http://localhost:3000/admin` to create posts.

## Changing the deployment target

Edit `nitro.config.ts` and set `preset`:

| Target             | `preset` value      |
| ------------------ | ------------------- |
| Node.js (default)  | `node-server`       |
| Cloudflare Workers | `cloudflare-module` |
| Vercel Edge        | `vercel-edge`       |
| Netlify Edge       | `netlify-edge`      |
| AWS Lambda         | `aws-lambda`        |

Turso's Hrana HTTP transport works on all targets since it only needs `globalThis.fetch`.

## Environment variables

| Variable            | Description                                   | Default         |
| ------------------- | --------------------------------------------- | --------------- |
| `LIBSQL_URL`        | Turso URL or `http://localhost:8080` for sqld | —               |
| `LIBSQL_AUTH_TOKEN` | Turso JWT (omit for local sqld)               | —               |
| `LIBSQL_TABLE`      | Table name for LaikaCMS storage               | `laika_storage` |
