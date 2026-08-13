# starter-workers-blog

A blog built with **Cloudflare Workers + R2 + LaikaCMS**.

Unlike the Node.js starters (Hono, Express, Astro), the Workers runtime does not have access to `node:fs`, so `createEmbeddedLaika` is unavailable. This starter wires the lower-level `laikaApi` by hand, using `R2StorageRepository` directly with the native Cloudflare R2 binding.

## Prerequisites

1. A [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers enabled.
2. [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`).
3. An R2 bucket:
   ```bash
   wrangler r2 bucket create starter-workers-blog-content
   ```
   The bucket name must match `bucket_name` in `wrangler.toml` (default: `starter-workers-blog-content`).

## Run it locally

```bash
npm install
npm run dev
```

`wrangler dev` starts a local Worker at <http://localhost:8787>. The blog is at `/`, the Decap admin at `/admin/`.

Dev authentication uses a hardcoded bearer token (`dev-local-laika-token`). Override it by setting `DEV_TOKEN` in `wrangler.toml` under `[vars]`.

## Deploy to Cloudflare

```bash
npm run deploy
```

This builds the admin bundle and calls `wrangler deploy`. The R2 bucket must already exist before deploying.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Build admin bundle + `wrangler dev` (local) |
| `npm run build` | Build admin bundle only |
| `npm run deploy` | Build + `wrangler deploy` to Cloudflare |
| `npm run typecheck` | TypeScript type-check (no emit) |

## How it's wired

```
src/index.ts          Worker entry: laikaApi wired to R2 + DecapCatalogProvider,
                       blog routes, /api/decap/* handler
src/decap-config.ts   Decap collection definitions (shared with admin bundle)
src/admin-client.ts   Admin entry point (bundled to public/admin/bundle.js)
src/cms.ts            Decap bare-app registration (widgets, backend)
wrangler.toml         R2 bucket binding, assets directory, compatibility flags
public/               Static assets served directly by Cloudflare (including the admin bundle)
```

On cold start, the Worker seeds `config.yml` into R2 (if absent) so `DecapCatalogProvider` can read the Decap configuration. Subsequent requests use a per-isolate cache to skip the R2 round-trip.

## Current limitation

There is no `createEmbeddedLaika`-equivalent for edge runtimes — the lower-level `laikaApi` wiring shown here is currently the canonical pattern for Workers. If you need a higher-level helper, [open an issue](https://github.com/laikacms/laikacms/issues).
