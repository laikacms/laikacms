# starter-react-router-blog

Minimal blog built with [React Router v7](https://reactrouter.com) (framework mode) and LaikaCMS.
React Router v7 is the successor to Remix v2 — it adds SSR, file-based routing, and server loaders
to React Router, all powered by Vite.

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config, documents repo,
  and the Decap JSON:API fetch handler.
- **`loader` functions** — run server-side on every request; use `laika.documents.*` directly, no
  HTTP round-trip needed.
- **`useLoaderData()`** — accesses server-loaded data inside React components with full type safety.
- **Resource route** — `/api/decap/*` passes the WHATWG `Request` straight to `laika.fetch`; React
  Router v7 provides it natively (no reconstruction from `IncomingMessage` needed).
- **Decap admin** — bootstrapped client-side via `useEffect`; SSR renders `null`.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173> for the blog and <http://localhost:5173/admin> for the CMS editor (dev
auth — no login required).

## Project layout

```
app/
  root.tsx              # HTML shell — Links, Meta, Scripts, Outlet
  routes.ts             # Route config (layout, index, blog, admin, API)
  layouts/
    blog.tsx            # Shared nav + container for blog routes
  routes/
    home.tsx            # loader: list posts; default: post list UI
    blog.$slug.tsx      # loader: load post; default: post detail UI
    admin.tsx           # Decap CMS bootstrap via useEffect (client-only)
    api.decap.$.tsx     # Resource route: proxies all methods to laika.fetch
  lib/
    laika.server.ts     # createEmbeddedLaika singleton (.server.ts = server-only)
    decap-config.ts     # Shared collection schema
content/                # Filesystem content root (git-tracked)
public/                 # Static assets (uploaded media)
react-router.config.ts  # ssr: true
vite.config.ts          # reactRouter() + tsconfigPaths() plugins
```

## Key React Router v7 differences from Remix v2

| Remix v2                                    | React Router v7                          |
| ------------------------------------------- | ---------------------------------------- |
| `@remix-run/react`                          | `react-router`                           |
| `@remix-run/node`                           | `@react-router/node`                     |
| `@remix-run/dev`                            | `@react-router/dev`                      |
| `json(data)`                                | `return data` (plain objects)            |
| Flat-file routing                           | Config-based `routes.ts` (preferred)     |
| `LoaderFunctionArgs` from `@remix-run/node` | `Route.LoaderArgs` from `./+types/route` |

The WHATWG `Request` is still passed directly to loaders and actions — the laika backend proxy is
identical to the Remix pattern.

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Build & deploy

```bash
react-router build
react-router-serve ./build/server/index.js
```
