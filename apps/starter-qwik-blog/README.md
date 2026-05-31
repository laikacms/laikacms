# starter-qwik-blog

Minimal blog built with [Qwik City](https://qwik.dev) and LaikaCMS. Qwik is a resumability-first
framework — components serialize state to HTML and resume execution in the browser without
hydration, making it naturally suited for content-heavy sites.

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config, documents repo,
  and the Decap JSON:API fetch handler.
- **`routeLoader$`** — Qwik City's server data loader; runs on the server, result is available in
  the component via a signal (`usePosts().value`).
- **`onRequest` handler** — Qwik City route handlers receive a WHATWG `Request` (`event.request`),
  so `laika.fetch(request)` works with no reconstruction. `throw send(response)` stops processing.
- **`useVisibleTask$`** — Qwik's client-only hook (runs after component is visible in the browser);
  used to bootstrap Decap CMS, analogous to React's `useEffect`.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173> for the blog and <http://localhost:5173/admin> for the CMS editor (dev
auth — no login required).

## Project layout

```
src/
  root.tsx                      # QwikCityProvider + RouterOutlet shell
  entry.ssr.tsx                 # SSR entry (renderToStream)
  entry.preview.tsx             # Node.js preview server via createQwikCity
  routes/
    index.tsx                   # routeLoader$: list posts; component$: post list UI
    blog/[slug]/index.tsx       # routeLoader$: load post; component$: post detail UI
    admin/index.tsx             # useVisibleTask$: Decap CMS bootstrap (client-only)
    api/decap/[...all]/index.ts # onRequest: WHATWG proxy to laika.fetch
  lib/
    laika.server.ts             # createEmbeddedLaika singleton (.server.ts = server-only)
    decap-config.ts             # Shared collection schema
content/                        # Filesystem content root (git-tracked)
public/                         # Static assets (uploaded media)
vite.config.ts                  # qwikCity() + qwikVite() + tsconfigPaths()
```

## Key Qwik City concepts vs React frameworks

| Concept            | React (Remix/RR7)                       | Qwik City                                |
| ------------------ | --------------------------------------- | ---------------------------------------- |
| Server data        | `loader()` → `useLoaderData()`          | `routeLoader$()` → `useMyLoader().value` |
| Client-only effect | `useEffect`                             | `useVisibleTask$`                        |
| API route          | Resource route (no default export)      | `onRequest` / `onGet` / `onPost` handler |
| Route params       | `params.slug` in loader arg             | `params.slug` in routeLoader$ arg        |
| 404                | `throw data('Not found', {status:404})` | `status(404); return null`               |

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Build & deploy

```bash
pnpm build           # builds client + server bundles via Vite
node server/entry.express  # or use the node-server adapter
```
