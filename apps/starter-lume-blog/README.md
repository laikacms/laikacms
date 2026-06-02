# starter-lume-blog

Minimal blog using [Lume](https://lume.land) (Deno SSG) + LaikaCMS. Demonstrates the **Jamstack
pattern** with a CMS:

- **Lume** generates static HTML from `content/posts/*.md` at build time — no LaikaCMS API calls
  needed in the build pipeline.
- **LaikaCMS admin sidecar** (separate Deno process) serves the Decap CMS editor and JSON:API for
  writing content. Lume's `--serve --watch` picks up file changes and regenerates.
- **`createEmbeddedLaika` on Deno 2** — same as `starter-fresh-blog`: works with
  `nodeModulesDir: "auto"` and `--allow-read/write` permissions.

## Quick start

```bash
# Needs Deno 2.x — https://deno.land
pnpm install      # install laikacms workspace packages
deno task dev     # starts both Lume (port 3000) and admin sidecar (port 3001)
```

| URL                         | What                   |
| --------------------------- | ---------------------- |
| http://localhost:3000       | Lume blog (SSG)        |
| http://localhost:3001/admin | Decap CMS admin editor |

## Project layout

```
_config.ts             # Lume site config (src: '.', ignores lib/ server/)
_includes/
  base.njk             # Base HTML layout
  post.njk             # Individual post layout
index.njk              # Blog homepage (lists posts from content/posts/)
content/
  posts/
    _data.yml          # Sets layout for all posts
    hello-world.md     # Sample post (edit or delete)
lib/
  decap-config.ts      # Decap CMS collection definitions
  laika.ts             # createEmbeddedLaika singleton (used by admin sidecar only)
server/
  admin.ts             # Deno admin sidecar — serves /admin and /api/decap/*
deno.json              # Deno tasks + Lume import map
package.json           # LaikaCMS workspace deps (for pnpm install)
```

## How the Jamstack pattern works

```
┌─────────────────────────────────────────────────────────────┐
│  Lume dev server (port 3000)                                │
│  deno task site:dev                                          │
│  reads content/posts/*.md → generates _site/                │
│  watches content/ → rebuilds on file change                  │
└───────────────────────────┬─────────────────────────────────┘
                            │ shares filesystem
┌───────────────────────────▼─────────────────────────────────┐
│  Admin sidecar (port 3001)                                   │
│  deno task admin:dev                                         │
│  GET  /admin           → Decap CMS HTML shell                │
│  ANY  /api/decap/*     → laika.fetch() JSON:API              │
│                          writes content/posts/*.md           │
└─────────────────────────────────────────────────────────────┘
```

1. Editor opens `http://localhost:3001/admin` and creates/edits a post.
2. Decap CMS calls `/api/decap/*` on the admin sidecar.
3. `laika.fetch()` writes the markdown file to `content/posts/`.
4. Lume's file watcher detects the change and regenerates `_site/`.
5. The browser reloads the blog.

## Why no `laika.documents.*` in the Lume build?

Lume already knows how to read markdown files. The build pipeline just reads `content/posts/*.md`
directly from the filesystem — no Effect, no `runTask`, no HTTP call needed.

You _can_ use `laika.documents.*` in `_config.ts` if you want programmatic access to the content
(e.g. to compute derived data, add full-text search index, or filter by custom fields):

```ts
// _config.ts (optional — advanced usage)
import { collectStream } from 'laikacms/compat';
import { laika } from './lib/laika.ts';

const site = lume({ ... });

// Run a LaikaCMS query at build time
site.addEventListener('afterBuild', async () => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({ folder: 'posts', depth: 1, type: 'published', pagination: { page: 1, perPage: 100 } }),
  );
  // items is typed; build a search index, generate a sitemap, etc.
  console.log(`Built with ${items.length} posts`);
});
```

## Deployment

```bash
deno task build   # generates _site/
```

Serve `_site/` as a static site (Netlify, Cloudflare Pages, GitHub Pages, any CDN). The admin
sidecar is a dev-only tool — for production CMS editing, deploy the sidecar to a persistent server
and configure production auth (see `createEmbeddedLaika` auth options).
