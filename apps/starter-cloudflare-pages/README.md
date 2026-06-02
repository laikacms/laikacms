# `@laikacms/starter-cloudflare-pages`

LaikaCMS on **Cloudflare Pages + Pages Functions**, with content in R2. Different deployment shape
from `apps/starter-workers-r2`:

| Aspect         | `starter-workers-r2`           | `starter-cloudflare-pages` (this)          |
| -------------- | ------------------------------ | ------------------------------------------ |
| Static assets  | Served from the Worker         | Served by Pages CDN directly (no Function) |
| API routes     | Same Worker handles everything | Pages Functions invoked only when needed   |
| Deploy command | `wrangler deploy` (Worker)     | `wrangler pages deploy public`             |
| Best for       | API-first / no static site     | Content site + backend APIs                |

Use this starter when the **primary surface is a static site** (HTML/CSS/JS in `public/`) and
LaikaCMS provides the editing API on the side. Use the Workers + R2 starter when there's no public
static site, just the API.

## Stack

- Cloudflare Pages (static asset host) + Pages Functions (V8 isolate compute)
- Hono inside the function
- `@laikacms/decap-integrations/workers` — `createWorkersLaika` + R2 binding
- Decap CMS shell served from a Function path

## Run locally

```bash
pnpm install
pnpm --filter @laikacms/starter-cloudflare-pages dev   # wrangler pages dev
```

Then:

- `http://localhost:3000` — static `public/index.html` (lists posts via `/api/posts`)
- `http://localhost:3000/api/admin` — Decap CMS admin
- `http://localhost:3000/api/posts` — JSON list

## Deploy

```bash
wrangler r2 bucket create laikacms-pages-content
wrangler r2 bucket create laikacms-pages-content-preview

pnpm --filter @laikacms/starter-cloudflare-pages deploy
```

## Layout

```
apps/starter-cloudflare-pages/
├── wrangler.toml                          # Pages config + R2 binding
├── public/
│   └── index.html                         # static, fetches /api/posts in the browser
└── functions/
    └── api/
        └── [[catchall]].ts                # PagesFunction → Hono → LaikaCMS
```

Anything under `public/` is a static asset. Anything under `functions/` is a Function — Pages only
invokes the Function when the URL doesn't match a static asset.

## Why two Cloudflare starters?

The Workers (`starter-workers-r2`) and Pages (this) starters share **the same handler code**
(`createWorkersLaika` + Hono routing) but differ in how Cloudflare deploys and routes them. For a
content website, Pages' static-asset CDN is faster + cheaper than serving HTML from a Worker. For an
API-only backend, the Worker form is leaner.

## Production hardening

Same checklist as the other starters. See [`docs/starters.md`](../../docs/starters.md) and
[`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
