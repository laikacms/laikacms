# Laika CMS examples

Standalone examples. This directory is **not** a workspace package: it has its own
`pnpm-workspace.yaml`, which makes it an independent pnpm root. Installing here creates a local
`examples/pnpm-lock.yaml` and `examples/node_modules` and never touches the main workspace or its
lockfile.

## Setup

Build the library first (from the repo root), then install here:

```sh
pnpm -C .. --filter laikacms build
pnpm install
```

`laikacms` is consumed via `file:../packages/laikacms`, so examples run against your local build.
Re-run the build after changing library code. To pin against a published release instead, replace
the `file:` specifier with a version.

Note: `pnpm clean` at the repo root removes `node_modules` everywhere, including here — just re-run
`pnpm install` in this directory afterwards.
