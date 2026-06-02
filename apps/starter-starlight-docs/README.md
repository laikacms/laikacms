# starter-starlight-docs

A documentation site built with [Astro Starlight](https://starlight.astro.build) and LaikaCMS. Edit
your docs through the Decap admin UI; content is stored as Markdown files in `src/content/docs/` and
rendered by Starlight.

## Stack

- **Framework**: Astro v5 + Starlight (docs theme)
- **Runtime**: Node.js 22 via `@astrojs/node` adapter
- **Storage**: Filesystem (`createEmbeddedLaika` → `src/content/`)
- **CMS**: Decap Admin from CDN

## Quick start

```bash
pnpm dev
```

Then open:

- `http://localhost:4321` — Starlight docs site
- `http://localhost:4321/admin/` — Decap CMS to edit docs

## How it works

```
src/
  content/
    content.config.ts     ← Astro v5 collection definition (required)
    docs/
      getting-started/
        index.md          ← Starlight page
      guides/
        first-guide.md
  pages/
    admin/
      index.astro         ← Decap admin UI (static HTML, loads from CDN)
    api/
      decap/
        [...path].ts      ← LaikaCMS fetch handler (SSR)
  laika/
    laika.ts              ← createEmbeddedLaika, contentDir = src/content
    decap-config.ts       ← Decap collection schema
```

**`contentDir = src/content`** (not `src/content/docs`). The Decap collection uses `folder: 'docs'`,
so files are stored at `src/content/docs/<slug>.md` — exactly where Starlight looks.

LaikaCMS also writes its own `config.yml` to `src/content/config.yml`. Astro v5 ignores this file
because only `src/content.config.ts` is recognized as a collection definition.

## File format

Starlight pages use frontmatter to configure the sidebar and set metadata:

```yaml
---
title: My Page
description: A brief description
sidebar:
  order: 1
  label: Custom Label  # optional, overrides title in sidebar
---

Page content goes here.
```

The Decap collection in `src/laika/decap-config.ts` includes all standard Starlight frontmatter
fields.

## Production note

In production, Starlight re-reads `src/content/docs/` on every request (SSR mode). However, **the
content layer caches entries at server startup** — new files written by Decap won't appear until the
server restarts or is redeployed.

For a fully live-editing workflow, consider triggering a rebuild via webhook on CMS save, or using a
CDN origin to serve newly-written files without a full deploy.

## Doc gaps surfaced

1. **Astro v5 requires explicit `src/content.config.ts`** — auto-generated collections are
   deprecated. The deprecation warning only appears at build/check time, not at runtime, so it's
   easy to miss. `docsLoader()` + `docsSchema()` from `@astrojs/starlight` must be imported
   explicitly.
2. **`contentDir` for Starlight must be `src/content` (not `src/content/docs`)** — the Decap
   collection's `folder: 'docs'` maps to the subdirectory. Setting `contentDir` to the `docs/`
   folder itself would require an empty `folder: ''` in Decap which may not be supported.
3. **Content layer caching on SSR** — Starlight (and Astro content layers generally) cache loaded
   entries at startup in SSR mode. Files created by Decap are written to disk but won't be served
   without a restart. This is not documented in LaikaCMS's CMS integration guides.
