# Laika CMS examples

> **Example apps have moved.** The ~160 `starter-*` reference apps that used to live here were
> relocated to separate repositories in June 2026. See
> [`docs/contributing/starters.md`](../docs/contributing/starters.md) for the current status and
> links once they are published.

This directory retains the `pnpm-workspace.yaml` scaffolding (used by the `examples/` isolated
workspace) but contains no runnable apps. The setup instructions below apply when example apps are
added back.

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
