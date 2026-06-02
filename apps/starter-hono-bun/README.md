# starter-hono-bun

Starter blog built with [Hono](https://hono.dev) running on [Bun](https://bun.sh) +
[LaikaCMS](https://laikacms.dev).

## What this demonstrates

- **Hono on Bun's native runtime** — no `@hono/node-server` adapter;
  `Bun.serve({ fetch: app.fetch })` is all you need.
- **Zero-adaptation `laika.fetch`** — `Bun.serve()` is WHATWG `Request`/`Response` native, so
  `laika.fetch(c.req.raw)` needs no bridging (unlike Express, Koa, or Fastify on Node.js).
- **`decapAdminHtml()` helper** — generates the full Decap CMS admin shell in one call. No
  `src/admin-client.ts`, no build step, no `public/admin/index.html` to maintain. CDN provides Decap
  and the Laika backend.
- **`minimalBlogConfig()`** — pre-baked single-collection blog config. One call configures the
  backend, media folder, and posts collection.
- **`laika.documents.*` via `laikacms/compat`** — `collectStream` and `runTask` read content without
  an extra HTTP round-trip.

Compare with related starters:

| Starter                | Framework | Runtime | Admin shell            |
| ---------------------- | --------- | ------- | ---------------------- |
| `starter-hono-blog`    | Hono      | Node.js | Bundle (esbuild)       |
| `starter-bun-blog`     | (none)    | Bun     | Bundle (esbuild)       |
| **`starter-hono-bun`** | **Hono**  | **Bun** | **`decapAdminHtml()`** |

## Getting started

```bash
cd apps/starter-hono-bun
bun install
bun run dev
```

Open <http://localhost:3000> to see the blog and <http://localhost:3000/admin> for the CMS.

## How it works

```
Bun.serve({ fetch: app.fetch, port: 3000 })
       │
       ▼
   Hono router
       │
       ├── /api/decap/*  → laika.fetch(c.req.raw)   # WHATWG-native, no bridge
       ├── /admin        → decapAdminHtml()           # CDN — no build step
       ├── /             → list posts via laika.documents.listRecordSummaries
       ├── /blog/:slug   → single post via laika.documents.getDocument
       └── /*            → static files via Bun.file()
```

Content is stored as Markdown in `content/posts/`. The Decap admin reads and writes via
`/api/decap/*`; Hono routes read the same files through `laika.documents.*`.

## Key integration notes

**Why no `@hono/node-server`?** `@hono/node-server` adapts Node.js's `IncomingMessage` to WHATWG
`Request` so Hono can run on Node. Bun already speaks WHATWG natively, so
`Bun.serve({ fetch: app.fetch })` replaces it entirely.

**`decapAdminHtml()` vs the bundle approach** Most starters use a separate `admin-client.ts` file
that is compiled to `public/admin/bundle.js` with esbuild. `decapAdminHtml()` skips that entirely —
it returns a self-contained HTML string that loads Decap CMS and the Laika backend from CDN. Use the
bundle approach when you need custom Decap widgets or non-default collection schemas; use
`decapAdminHtml()` with `minimalBlogConfig()` when the defaults are enough.

**Static files with `Bun.file()`** `Bun.file(path)` returns a `Blob`-like object that `Response`
accepts directly, streaming the file without reading it into memory. There is no `serveStatic`
middleware needed.

## Project structure

```
apps/starter-hono-bun/
├── content/
│   └── posts/          # Markdown posts managed by LaikaCMS
├── public/             # Media uploads land here (public/uploads/)
├── src/
│   ├── index.ts        # Hono app + Bun.serve()
│   └── laika.ts        # minimalBlogConfig() + createEmbeddedLaika singleton
├── package.json
└── tsconfig.json
```
