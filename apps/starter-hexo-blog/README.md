# starter-hexo-blog

Starter blog built with [Hexo](https://hexo.io) 8 + [LaikaCMS](https://laikacms.dev).

## What this demonstrates

- **SSG sidecar pattern** — LaikaCMS manages `source/_posts/` as a CMS backend; Hexo reads the same
  Markdown files at build time. No runtime document API needed for the public blog.
- **Hexo server middleware** — `scripts/laika-server.mjs` registers a Hexo server filter that
  intercepts `/api/decap/*` and bridges `IncomingMessage` → WHATWG `Request` for `laika.fetch`.
- **`decapAdminHtml()` helper** — the admin shell is generated server-side; no separate admin bundle
  build step.
- **ESM in Hexo scripts** — Hexo 8 supports `.mjs` scripts loaded as ESM. LaikaCMS packages are
  ESM-only so the `.mjs` extension is required (see doc gaps below).

## Getting started

```bash
cd apps/starter-hexo-blog
pnpm install
pnpm dev          # starts Hexo dev server on http://localhost:4000
```

Then:

- Blog: <http://localhost:4000>
- CMS admin: <http://localhost:4000/admin>

Create a post in the admin, then reload the blog — Hexo's server re-reads `source/_posts/`
automatically on each request.

To build the static site:

```bash
pnpm build        # generates HTML into public/
```

## How it works

```
hexo server (port 4000)
       │
       ├── /api/decap/*  → laika.fetch (IncomingMessage→Request bridge)
       ├── /admin        → decapAdminHtml() — no build step
       └── /*            → Hexo's own rendering (reads source/_posts/)
```

```
source/
  _posts/           ← LaikaCMS writes here (collection folder = "_posts")
    my-post.md      ← Hexo reads and renders as /blog/YYYY/MM/DD/my-post/
  config.yml        ← written by createEmbeddedLaika (Hexo ignores YAML files)
  images/           ← media uploads from Decap admin
```

## Doc gaps surfaced

**ESM/CJS interop:** Hexo scripts in `scripts/` are loaded as CommonJS by default. Because LaikaCMS
packages are ESM-only, `require('@laikacms/...')` fails. The fix is to name the script `.mjs` (Hexo
8+ loads `.mjs` files as ESM). This is not documented in the LaikaCMS getting-started guide — worth
calling out explicitly.

**`contentDir` vs collection `folder`:** `createEmbeddedLaika` writes its config YAML to
`<contentDir>/config.yml` and stores collection files at `<contentDir>/<collection.folder>/`. By
setting `contentDir = 'source'` and `folder = '_posts'`, posts land in `source/_posts/` — exactly
where Hexo expects them. The `config.yml` that Laika creates at `source/config.yml` is ignored by
Hexo (it processes only Markdown and EJS files, not YAML).

**Date format:** Decap's `datetime` widget emits ISO 8601 (`2024-01-15T12:00:00.000Z`). Hexo parses
this correctly via `moment.js` and applies `date_format` from `_config.yml` when rendering. No
manual conversion is needed.

**`IncomingMessage` → WHATWG Request bridge:** The same pattern as `starter-express-blog`,
`starter-koa-blog`, and `starter-eleventy-blog`. `laika.fetch` expects a WHATWG `Request`; Hexo's
server middleware provides a Node.js `IncomingMessage`. The bridge in
`scripts/laika-server.mjs::toLaikaRequest` streams the body manually — do **not** add any body
parser middleware in front of `/api/decap/*`.

## Project structure

```
apps/starter-hexo-blog/
├── _config.yml             # Hexo configuration
├── scaffolds/
│   └── post.md             # Template for new posts (hexo new)
├── scripts/
│   └── laika-server.mjs    # Hexo filter: LaikaCMS middleware (must be .mjs)
├── source/
│   └── _posts/             # Blog posts — written by LaikaCMS, read by Hexo
├── themes/
│   └── landscape/          # Default Hexo theme (install via hexo-theme-landscape)
├── package.json
└── tsconfig.json
```

> **Note:** The Hexo landscape theme is not bundled here. Run `hexo init --theme landscape` or
> install `hexo-theme-landscape` via npm if you need the default theme assets.
