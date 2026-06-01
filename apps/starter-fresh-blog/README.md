# starter-fresh-blog

Starter blog built with **[Deno Fresh 1.7](https://fresh.deno.dev/)** + LaikaCMS.

## What this demonstrates

- `createEmbeddedLaika` running on **Deno 2** (not just Node.js — see note below)
- Fresh **file-based routing** — routes are `.tsx`/`.ts` files in `routes/`
- Server-side data via **`Handlers + ctx.render()`** (no client JS for the blog)
- Decap CMS admin served as a raw `Response` via `decapAdminHtml()` — no
  island or Preact hydration, so Decap CMS can own the full `<html>` document
- `laika.fetch(req)` as a **zero-adapter Decap proxy** — Fresh passes a
  WHATWG Request, exactly what `laika.fetch` expects

## Quick start

```bash
# Needs Deno 2.x — https://deno.land
deno task dev
# http://localhost:8000       ← blog home
# http://localhost:8000/admin ← Decap CMS editor
```

`deno task dev` auto-updates `fresh.gen.ts` and serves with hot reload.
`deno task start` uses the committed `fresh.gen.ts` (no build step required).

## Project layout

```
routes/
  index.tsx                 # Blog home — lists published posts (SSR)
  admin.tsx                 # Decap CMS shell — raw Response, no hydration
  blog/[slug].tsx           # Individual post page (SSR)
  api/decap/[...path].ts    # LaikaCMS Decap JSON:API proxy (catch-all)
lib/
  laika.ts                  # createEmbeddedLaika singleton
  decap-config.ts           # Decap CMS collection definitions
content/                    # Markdown posts (written by Decap CMS)
public/uploads/             # Uploaded media
fresh.config.ts             # Fresh plugin config (empty — no plugins needed)
fresh.gen.ts                # Route manifest — committed, auto-updated by dev.ts
main.ts                     # Production entry (requires fresh.gen.ts)
dev.ts                      # Dev entry (auto-regenerates fresh.gen.ts)
deno.json                   # Deno tasks + Fresh import map + compiler options
package.json                # LaikaCMS workspace deps (for pnpm install)
```

## `createEmbeddedLaika` on Deno 2

`createEmbeddedLaika` calls `node:fs.mkdirSync` at module-load time, which
is why the docs say "Node-only". Deno 2 fully supports `node:` built-ins, so
it works here too — provided two things:

1. **`"nodeModulesDir": "auto"` in `deno.json`** — tells Deno to resolve npm
   packages from `node_modules/`, where pnpm has installed the workspace
   packages (`laikacms`, `@laikacms/decap-integrations`).
2. **`--allow-read` and `--allow-write`** — needed for filesystem access.
   Both are included in `deno run -A` used by `deno task dev/start`.

## Fresh routing notes

- **`[...path]` catch-all** — `routes/api/decap/[...path].ts` catches any
  path under `/api/decap/`. Fresh passes `ctx.params.path` as an array of
  segments (unused here — we forward the entire original Request to
  `laika.fetch(req)`).
- **Raw Response in a route** — a route's `handler.GET` can return any
  `Response`. If no default-exported component is present, Fresh serves the
  Response as-is. The admin route uses this to bypass Preact SSR entirely.
- **`fresh.gen.ts`** must be committed. If you add a new route, run
  `deno task build` to regenerate it, then commit the updated file.

## vs. `starter-deno-blog`

| | `starter-deno-blog` | `starter-fresh-blog` |
|---|---|---|
| Routing | Manual `if/else` in `Deno.serve` | File-based (`routes/`) |
| Rendering | Template literals | Preact JSX + SSR |
| Admin | Bundled via esbuild | `decapAdminHtml()` — no build |
| Entry point | Single `src/main.ts` | `dev.ts` + `main.ts` + `fresh.gen.ts` |
