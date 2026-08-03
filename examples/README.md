# Laika CMS examples

Standalone examples. This directory has its own `pnpm-workspace.yaml` that declares
`../packages/laikacms` as a local workspace member, keeping the lockfile and `node_modules` here
and away from the main workspace.

## Setup

Build the library first (from the repo root), then install here:

```sh
pnpm -C .. --filter laikacms build
pnpm install
```

`laikacms` is consumed from the local source tree (`workspace:*`), so examples run against your
local build. Re-run the build after changing library code.

Note: `pnpm clean` at the repo root removes `node_modules` everywhere, including here — just re-run
`pnpm install` in this directory afterwards.
