# starter-lume-blog

Minimal blog built with [Lume](https://lume.land) (Deno SSG) + LaikaCMS.

Lume is Deno's answer to Eleventy — a flexible static site generator that reads markdown,
Nunjucks, JSX, and more. Because Lume only generates static HTML (no runtime server), LaikaCMS
runs as a **sidecar process** on a separate port — the same Jamstack pattern as the Eleventy and
Hexo starters.

## Quick start

```bash
# Requires Deno 2.x; pnpm install populates node_modules/ for admin server
pnpm install

# Run both Lume and the admin sidecar concurrently
pnpm dev

# Or run them separately:
pnpm site:dev   # http://localhost:4000 — Lume dev server
pnpm admin:dev  # http://localhost:3001/admin — Decap CMS editor
```

## How it works

```
┌──────────────────────────────────────────────────────────┐
│ pnpm site:dev          │ pnpm admin:dev                  │
│ Lume → _site/          │ Hono → :3001                    │
│ port 4000              │  GET /admin → Decap UI          │
│                        │  ALL /api/decap/* → laika.fetch │
│ watches src/posts/*.md ←── writes ─────────────────────── │
└──────────────────────────────────────────────────────────┘
```

When you save a post in the Decap editor, the Laika API writes to `src/posts/`. Lume's watch
mode detects the change and rebuilds the static site.

## Key patterns

### Jamstack sidecar pattern

Lume (like Eleventy/Hexo) is a build tool, not a server. LaikaCMS can't be embedded in Lume's
build pipeline — it runs as a standalone Hono process that only handles the Decap API and admin UI.

### Content directory mapping

LaikaCMS `contentDir` is `src/` and the Decap collection uses `folder: 'posts'`:

```
contentDir = src/       ← createEmbeddedLaika root
folder = posts          ← Decap collection folder
```

Files are stored at `src/posts/*.md`, which is exactly where Lume reads them from.

### Hono on Deno

The admin sidecar uses Hono with Deno's native fetch handler:
```ts
// Deno's Hono import (from npm)
import { Hono } from '@hono/hono';

// Deno.serve's request → Hono → c.req.raw is WHATWG Request
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Serve with Deno.serve (Hono returns a fetch-compatible handler)
Deno.serve({ port: PORT }, app.fetch);
```

### `api_root` in the backend config

Use `api_root` (not `api_url`) in the backend block passed to `minimalBlogConfig()`. The laika-
backend reads `config.backend.api_root` to construct API URLs like `/api/decap/documents`.

## Project layout

```
_config.ts          Lume configuration (src → _site, Nunjucks plugin)
src/
  index.md          Blog home (lists posts via lume search.pages())
  posts/
    _data.yml       Shared front-matter: layout + type for all posts
    hello-world.md  Sample post
  _layouts/
    base.njk        HTML shell with nav
    post.njk        Single post layout
admin/
  server.ts         Hono sidecar — /admin + /api/decap/*
  laika.ts          createEmbeddedLaika + ADMIN_HTML + decapConfig
  concurrently.ts   Runs Lume + admin via Deno.Command
deno.json           Deno tasks + imports (@hono/hono, lume/)
package.json        pnpm workspace membership
```

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Deno permissions

| Permission      | Why                                       |
| --------------- | ----------------------------------------- |
| `--allow-net`   | HTTP server for admin + outbound fetch    |
| `--allow-read`  | Read `src/` (content + uploads)           |
| `--allow-write` | Write `src/posts/` (Decap saves)          |
| `--allow-run`   | `concurrently.ts` spawns Lume + admin     |
