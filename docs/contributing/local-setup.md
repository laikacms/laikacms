# Local setup

## Requirements

- Node.js `24.x` and pnpm `>=8 <11` (see the root `package.json`'s `engines` field). The repo's
  `packageManager` field pins the exact pnpm version — run `corepack use pnpm@<version>` (or install
  that pnpm globally) if `pnpm --version` doesn't match.

## Clone and install

```bash
git clone https://github.com/laikacms/laikacms.git
cd laikacms
pnpm install
```

`pnpm install` also runs the root `prepare` script (`husky`), which wires up the git hooks described
in [Landing a PR](./landing-a-pr).

pnpm will print a warning that it ignored some dependencies' install scripts (`esbuild`, `dprint`,
`@parcel/watcher`, `msgpackr-extract`, …) and suggest `pnpm approve-builds`. That's expected — none
of those scripts are required for the workspace's own build/test/lint to run; only approve them if a
tool you're using turns out to need its native/postinstall step.

## Build

```bash
pnpm build
```

This runs `turbo run build` across every package. Turbo resolves the dependency graph (`^build`) so
each package builds after the packages it depends on.

## Verify the checkout

```bash
pnpm test
```

`pnpm test` (via turbo) builds first, then runs each package's `vitest run`. A clean run here means
your checkout is in a working state — see [Inner loop](./inner-loop) for the day-to-day version of
this loop.
