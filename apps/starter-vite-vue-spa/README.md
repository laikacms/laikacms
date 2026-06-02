# `@laikacms/starter-vite-vue-spa`

A **pure client-side Vue 3 SPA** built with Vite, served alongside a sidecar Hono backend that hosts
LaikaCMS + Decap. The Vite dev server proxies `/api/*` and `/admin` to the backend so the two
processes feel like one origin.

Use this starter when:

- You want a SPA architecture (no SSR), and you're happy fetching content over HTTP.
- You're building a Vue dashboard / app that should not have a Vue server, but still wants
  LaikaCMS-managed content.
- You want the smallest possible backend surface — the Hono process here is ~40 lines.

## Stack

- Vite + Vue 3 + Vue Router 4 (SPA)
- Hono + `@hono/node-server` (sidecar backend, port 3001)
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika` + `minimalBlogConfig`
- Decap CMS shell loaded from a CDN
- `concurrently` runs both processes

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-vite-vue-spa dev
```

`pnpm dev` runs both processes:

- Vite on `http://localhost:3000` (SPA) — opens in the browser.
- Hono on `http://localhost:3001` (API + admin).

Vite proxies `/api/*` and `/admin` from `:3000` to `:3001`, so the SPA can call
`fetch('/api/posts')` and the admin link works as `/admin`.

## Layout

```
apps/starter-vite-vue-spa/
├── content/posts/hello-world.md
├── index.html
├── src/                                # Vue SPA
│   ├── main.ts
│   ├── router.ts
│   ├── App.vue
│   └── views/
│       ├── Home.vue                    # fetches /api/posts on mount
│       └── Post.vue                    # fetches /api/posts/:slug on mount
├── server/                             # Sidecar backend (separate Node process)
│   ├── server.ts                       # Hono on :3001
│   └── admin/index.html                # Decap CMS shell
├── vite.config.ts                      # SPA + /api → :3001 proxy
└── tsconfig.json
```

## Production

Build the SPA:

```bash
pnpm build
```

You get static assets in `dist/`. Two common production deployments:

1. **Same-origin** — serve `dist/` from the same Hono process that hosts `/api/*` and `/admin`.
   Replace the `serve()` call with one that also serves static files (`@hono/node-server` +
   `serve-static`).
2. **Static host + API backend** — put `dist/` on Netlify/Vercel/S3, deploy the Hono server anywhere
   Node runs, and configure the host to proxy `/api/*` to your backend. (Or use full URLs from the
   SPA — but then you need to handle CORS and the dev-mode token.)

## Why a SPA?

Because not every product is a content website. A Vue dashboard, a marketing experiment, a
single-page editor — all reasonable use cases where SSR is overkill but you still want
LaikaCMS-managed content. This starter is the proof point: LaikaCMS doesn't _require_ SSR.

See [`docs/starters.md`](../../docs/starters.md).
