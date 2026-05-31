# `@laikacms/starter-eleventy-jamstack`

A **Jamstack** starter: Eleventy (11ty) renders a static blog at build time from markdown files, and
a small sidecar Hono server hosts the Decap CMS admin. The two share the same `content/posts/`
directory on disk.

Use this starter when you want:

- A fully static public site — zero client-side JS required.
- Authors to edit content in Decap (live admin), but the public output to be plain HTML files you
  can deploy anywhere (Netlify, S3, GitHub Pages, your own server).

## Stack

- **Site (build-time):** Eleventy 3, Nunjucks templates
- **Admin (runtime):** Hono + `@hono/node-server` + LaikaCMS embedded preset
- Decap CMS shell loaded from a CDN

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-eleventy-jamstack dev
```

`pnpm dev` runs both processes via `concurrently`:

- Eleventy serves the public site on `http://localhost:3000` and rebuilds when files change.
- The Hono admin server serves Decap at `http://localhost:3001/admin` and the JSON:API at
  `http://localhost:3001/api/decap/*`.

Edit a post in the admin → file changes in `content/posts/` → Eleventy regenerates the static page →
refresh `localhost:3000`.

## Build a deployable static site

```bash
pnpm build
```

Eleventy writes the static site to `_site/`. Upload that directory to any static host.

For production, you typically run **only** Eleventy (no live admin) and rely on a hosted admin
elsewhere (e.g. `apps/laika-gateway`, or a separate Hono+R2 deployment). See
[`docs/decap-integration.md`](../../docs/decap-integration.md) for the multi-tenant pattern.

## Layout

```
apps/starter-eleventy-jamstack/
├── .eleventy.js                      # Eleventy config
├── content/
│   ├── _layouts/
│   │   ├── base.njk
│   │   └── post.njk
│   ├── index.njk                     # home page (lists collections.posts)
│   └── posts/
│       ├── posts.json                # data-cascade defaults (layout + permalink)
│       └── hello-world.md
└── server/
    ├── admin.ts                      # Hono admin server
    └── admin.html                    # Decap CMS shell
```

## Why a separate admin process?

Eleventy is a static site generator — it doesn't have a runtime server that can accept POSTs from
Decap. Pairing it with a tiny Hono server is the cleanest Jamstack shape: each process does one
thing, and they cooperate through the filesystem. The public output stays 100% static.

## Production hardening

Same as the other starters:

1. **Auth** — swap `auth: { mode: 'dev' }` for `mode: 'custom'`.
2. **Storage** — for multi-host or read-only deployments, swap the FileSystem repo for
   `R2StorageRepository` / `GitHubStorageRepository`. Then your Eleventy build pulls content from
   the same source the admin writes to.
3. **Decap shell** — self-host the bundle.

See [`docs/starters.md`](../../docs/starters.md).
