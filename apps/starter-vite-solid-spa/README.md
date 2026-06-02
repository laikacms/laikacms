# `@laikacms/starter-vite-solid-spa`

A **pure client-side Solid.js SPA** built with Vite, alongside a sidecar Hono backend hosting
LaikaCMS + Decap. Same shape as `starter-vite-vue-spa` — different reactive framework.

Use this starter when you want a SPA with **signal-based reactivity** (Solid) and the smallest
possible runtime JS payload.

## Stack

- Vite + Solid.js 1.9 + `@solidjs/router`
- Hono + `@hono/node-server` (sidecar on port 3001)
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika` + `minimalBlogConfig`
- Decap CMS shell from a CDN

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-vite-solid-spa dev
```

`pnpm dev` runs both processes concurrently:

- Vite on `http://localhost:3000` — the Solid SPA
- Hono on `http://localhost:3001` — `/api/*` + `/admin`

Vite proxies `/api/*` and `/admin` from `:3000` to `:3001`, so the SPA hits same-origin paths.

## Layout

```
apps/starter-vite-solid-spa/
├── content/posts/hello-world.md
├── index.html
├── src/                                # Solid SPA
│   ├── main.tsx                        # render + router
│   ├── App.tsx                         # layout
│   └── views/
│       ├── Home.tsx                    # createResource → /api/posts
│       └── Post.tsx                    # createResource → /api/posts/:slug
├── server/                             # Sidecar backend
│   ├── server.ts                       # Hono on :3001
│   └── admin/index.html                # Decap CMS shell
├── vite.config.ts                      # solid plugin + proxy
└── tsconfig.json
```

## Solid vs. Vue idioms

Same data flow, different syntax. For comparison with `starter-vite-vue-spa`:

| Concern          | Vue                           | Solid                                        |
| ---------------- | ----------------------------- | -------------------------------------------- |
| Reactive state   | `ref(value)` / `.value`       | `signal()` (and resources for async)         |
| Lifecycle        | `onMounted`                   | `createResource` runs on mount automatically |
| Conditional      | `<el v-if="...">` / `v-else`  | `<Show when={...} fallback={...}>`           |
| List rendering   | `<li v-for="..." :key="...">` | `<For each={...}>{item => ...}</For>`        |
| Reactivity model | Virtual DOM diffing           | Fine-grained signals, no VDOM                |

## Production

See [`docs/starters.md`](../../docs/starters.md) for the same harden-before-deploy checklist as the
other starters.
