# `@laikacms/starter-htmx-hono`

A **server-rendered HTML + HTMX** blog. No React, no Vue, no client-side router. Hono renders HTML
on the server using `hono/jsx`; HTMX glues partial updates onto the page. The page on the client is
the application state.

Demonstrates that LaikaCMS isn't tied to the SPA / SSR-framework world — the hypermedia paradigm
works fine.

## Stack

- Hono + `hono/jsx` (server-side JSX rendering)
- HTMX 2 (loaded from a CDN — no build)
- `laikacms` — FileSystem storage + ContentBase document model
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika`, `minimalBlogConfig`,
  `decapAdminHtml`

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-htmx-hono dev
```

Then:

- `http://localhost:3000` — home page, server-rendered HTML
- `http://localhost:3000/admin` — Decap CMS admin
- `http://localhost:3000/posts/hello-world` — single post

The "Refresh posts" button on the home page issues `hx-get="/fragments/posts"` and swaps
`#post-list` with the new HTML — no full page reload, no JSON API.

## Layout

```
apps/starter-htmx-hono/
├── content/posts/hello-world.md
├── src/
│   └── server.tsx                # Hono app + JSX components + routes
└── tsconfig.json
```

The whole app is one file (~150 lines). That's kind of the point.

## What HTMX gives you

HTMX is ~14 KB of JavaScript that adds attributes to your HTML:

- `hx-get` / `hx-post` / `hx-put` / `hx-delete` — issue requests
- `hx-target` — which DOM node to swap
- `hx-swap` — how to swap (innerHTML, outerHTML, etc.)
- `hx-trigger` — when to fire (click, change, polling, etc.)

The server returns **HTML fragments**, not JSON. The browser swaps them in. The state of your
application is the HTML on the page.

## Production hardening

Same checklist as the other starters: real auth, persistent storage, self-hosted Decap shell. See
[`docs/starters.md`](../../docs/starters.md).
