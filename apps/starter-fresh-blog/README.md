# starter-fresh-blog

Minimal blog built with [Deno Fresh 1](https://fresh.deno.dev) and LaikaCMS.

## Key integration points

- **No adapter needed** — Fresh's handlers receive and return WHATWG `Request`/`Response` natively,
  which is exactly what `laika.fetch` speaks. The API proxy is just
  `export const handler = { GET: (req) => laika.fetch(req), … }` — one line per method.
- **`createEmbeddedLaika` works on Deno** — it uses `node:fs` and `node:path` internally. Deno's
  built-in Node.js compatibility layer handles both. The `deno.json` tasks include
  `--allow-read --allow-write` so file system operations succeed.
- **`decapAdminHtml()` without esbuild** — the `/admin` route returns `decapAdminHtml()` as a raw
  `Response` (bypassing the `_app.tsx` layout). No bundle step is required because `decapAdminHtml()`
  generates a complete standalone page that loads Decap CMS and the laika backend from CDN.
- **`nodeModulesDir: auto`** — enables Deno to resolve `laikacms` and `@laikacms/decap-integrations`
  from the pnpm workspace's `node_modules` using the `node:` protocol.

## Quick start

```bash
pnpm install
pnpm dev     # deno task start — watches routes/ and static/
```

Open <http://localhost:8000> for the blog and <http://localhost:8000/admin> for the CMS.

## Project layout

```
deno.json          # Deno tasks, import map, nodeModulesDir: auto
package.json       # workspace deps (pnpm)
fresh.config.ts    # Fresh configuration
fresh.gen.ts       # Route manifest (auto-updated by dev.ts, check into git)
dev.ts             # Dev server entry (runs Fresh's dev mode)
main.ts            # Production entry (runs Fresh's server)
lib/
  decap-config.ts  # Shared Decap CMS collection config
  laika.ts         # createEmbeddedLaika singleton
routes/
  _app.tsx         # App layout (<html>, <head>, <body>)
  _404.tsx         # 404 page
  index.tsx        # Blog index (handler + page component)
  admin.ts         # Decap admin — raw Response, bypasses _app.tsx
  api/
    decap/
      [...path].ts # Laika/Decap proxy — all HTTP methods → laika.fetch
  blog/
    [slug].tsx     # Post detail page
content/
  posts/           # Markdown files managed by Decap CMS
static/
  uploads/         # Media uploads (served by Fresh as static files)
```

## Why no adapter?

Express, Fastify, Koa and other Node.js HTTP servers receive Node.js `IncomingMessage` objects and
need a bridge to construct a WHATWG `Request` before calling `laika.fetch`. Fresh uses Deno's
native HTTP stack (also WHATWG-based), so the conversion is zero-cost.

See `docs/decap-integration.md` for the full adapter reference.

## Deno permissions

| Permission      | Why it is needed                                               |
| --------------- | -------------------------------------------------------------- |
| `--allow-net`   | HTTP server + any outbound fetch inside laika                  |
| `--allow-read`  | `node:fs` read ops in `createEmbeddedLaika`; serving `static/` |
| `--allow-write` | `node:fs` write ops — Decap CRUD creates/updates content files |
| `--allow-env`   | `$std/dotenv/load.ts` reads `.env`                             |
