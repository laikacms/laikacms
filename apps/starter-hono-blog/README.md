# starter-hono-blog

Minimal blog starter built with **[Hono](https://hono.dev/)** and **LaikaCMS**.

## Why Hono?

Hono uses the WHATWG Fetch API (`Request` / `Response`) natively — the same interface `laika.fetch`
expects. There is no bridging layer between the framework and LaikaCMS (contrast with Express, which
needs a `IncomingMessage → Request` adapter). This makes Hono an excellent target for edge runtimes
(Cloudflare Workers, Deno Deploy, Bun) with minimal changes.

## Features

- `createEmbeddedLaika` — single-process embedded CMS with filesystem storage
- `laika.documents.*` via `laikacms/compat` — `runTask` / `collectStream`
- Decap CMS admin from CDN at `/admin/`
- `@hono/node-server` for local Node.js development

## Getting started

```bash
pnpm install
pnpm dev       # build admin bundle + start tsx watch
```

Then open:

| URL                            | Description                                   |
| ------------------------------ | --------------------------------------------- |
| `http://localhost:3000/`       | Blog index                                    |
| `http://localhost:3000/admin/` | Decap CMS editor (dev auth — no login needed) |

## Adapting to an edge runtime

Replace `@hono/node-server` with the target adapter and export `app.fetch`:

```ts
// Cloudflare Workers
export default { fetch: app.fetch };

// Deno / Bun
Deno.serve(app.fetch);
```

The `createEmbeddedLaika` call uses `FileSystemStorageRepository`, which only works on runtimes with
local filesystem access. For edge deployments, swap the storage backend (e.g. `@laikacms/storage-kv`
for Workers KV).

## Project structure

```
src/
  index.ts         Hono app (routes + serve)
  laika.ts         createEmbeddedLaika singleton
  decap-config.ts  Decap CMS collection definitions
  admin-client.ts  Browser bundle entry for Decap admin
public/
  admin/
    index.html     Admin shell (loads Decap from CDN)
    bundle.js      Built by esbuild from admin-client.ts
content/           LaikaCMS content root (posts/, config.yml, …)
```
