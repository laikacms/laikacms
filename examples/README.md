# Laika CMS examples

> **Curating 5 of ~140 starters (LCMS-455).** In June 2026 the ~160 `starter-*` reference apps were
> moved out of the monorepo. A **curated set of 5** — each representing one way LaikaCMS is wired —
> is being brought back here to double as tested references and as StackBlitz previews in the docs.
> The remaining **~135 starters are deferred** (not dropped) and will be migrated later as demand
> warrants. See [`docs/contributing/starters.md`](../docs/contributing/starters.md).

## Included examples

| Example | Docs section | Demonstrates |
| --- | --- | --- |
| [`starter-vite-react-blog`](./starter-vite-react-blog) | Client | client-side content wiring |
| [`starter-hono-blog`](./starter-hono-blog) | Server (default) | secure-by-default `decap-api` proxy |
| [`starter-workers-blog`](./starter-workers-blog) | Server → edge | runtime-agnostic Cloudflare deploy |
| [`starter-astro-blog`](./starter-astro-blog) | Static | build-time compilation via the vite plugin |
| [`starter-github-blog`](./starter-github-blog) | Grows into | DB-free, git-backed collections |

> ⚠️ **Staged, not yet migrated.** These trees were copied from the pre-restructure app set
> (`laika-cms-website/apps/`) in anticipation of LCMS-455 and are **not yet runnable against current
> LaikaCMS**. Before each embed goes live it must be migrated: rename `@laikacms/decap-integrations`
> → `@laikacms/decap`, replace `@laikacms/cloudflare` with the `laikacms/storage/*` subpaths, adopt
> the `decap-api` `authorize` callback and `WebStorageRepository` (LCMS-451), and be wired into the
> workspace below so it installs, typechecks, and builds. Until then they are **excluded from the
> examples workspace** (see `pnpm-workspace.yaml`, which only lists `../packages/laikacms`) so
> `pnpm install` here is unaffected.

## Setup (once an example is migrated)

## Setup (for future example apps)

Build the library first (from the repo root), then install here:

```sh
pnpm -C .. --filter laikacms build
pnpm install
```

`laikacms` is consumed from the local source tree (`workspace:*`), so examples run against your
local build. Re-run the build after changing library code.

Note: `pnpm clean` at the repo root removes `node_modules` everywhere, including here — just re-run
`pnpm install` in this directory afterwards.
