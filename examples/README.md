# Laika CMS examples

> **Runnable starters now live in [`../starters`](../starters).** The curated `starter-*` apps that
> were briefly staged here have moved to the top-level `starters/` directory, where they ship as
> download-and-go templates pinned to published LaikaCMS versions (no `workspace:`/`catalog:`
> protocols). See [`starters/README.md`](../starters/README.md).

This directory retains the `pnpm-workspace.yaml` scaffolding (an isolated `examples/` workspace that
consumes `laikacms` from local source) for any future in-repo example that should build against the
working tree rather than a published release. It currently contains no apps.

## Setup (for a future in-repo example)

Build the library first (from the repo root), then install here:

```sh
pnpm -C .. --filter laikacms build
pnpm install
```

`laikacms` is consumed from the local source tree (`workspace:*`), so examples run against your
local build. Re-run the build after changing library code.

Note: `pnpm clean` at the repo root removes `node_modules` everywhere, including here — just re-run
`pnpm install` in this directory afterwards.
