# starter-bun-blog

Minimal blog built with [Bun](https://bun.sh)'s native HTTP server and LaikaCMS. Bun's `serve()`
uses the WHATWG `Request`/`Response` API natively, so `laika.fetch(request)` requires **zero
adaptation** — the cleanest possible integration point for LaikaCMS.

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config, documents repo,
  and the Decap JSON:API fetch handler.
- **`Bun.serve()`** — WHATWG-native HTTP server; the `fetch` handler receives a `Request` and
  returns a `Response`. No framework, no middleware chain, no `IncomingMessage` wrapping.
- **`laika.fetch(request)`** — passed the raw WHATWG `Request` from `Bun.serve()` directly.
- **Server-side rendering** — plain template literals for HTML; no framework overhead.
- **Decap admin** — `admin-client.ts` built via esbuild to `public/admin/index.js`, loaded by the
  admin page HTML.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS editor (dev
auth — no login required).

## Project layout

```
src/
  server.ts         # Bun.serve() — routes, HTML rendering, static files
  laika.ts          # createEmbeddedLaika singleton
  decap-config.ts   # Shared collection schema (server + admin client)
  admin-client.ts   # Browser bundle: Decap CMS init (built by esbuild)
content/            # Filesystem content root (git-tracked)
public/
  uploads/          # Uploaded media
  admin/index.js    # Built by `pnpm build:admin` (gitignored)
tsconfig.json       # Server TypeScript config (Bun types, no DOM)
tsconfig.admin.json # Browser TypeScript config (DOM types, no Bun)
```

## Why Bun?

| Concern       | Bun                           | Node (Express)                         |
| ------------- | ----------------------------- | -------------------------------------- |
| Request type  | WHATWG `Request` (native)     | `IncomingMessage` (must reconstruct)   |
| Response type | WHATWG `Response` (native)    | `ServerResponse` (must write manually) |
| Static files  | `Bun.file(path)` → `Response` | `express.static()` middleware          |
| Runtime speed | ~3× faster startup            | baseline                               |

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Build & deploy

```bash
pnpm build:admin          # esbuild admin-client.ts → public/admin/index.js
bun src/server.ts         # serve
```
