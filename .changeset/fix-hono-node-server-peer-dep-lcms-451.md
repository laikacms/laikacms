---
"laikacms": patch
---

Widen `@hono/node-server` optional peer dependency from `^1.19.11` to `^2.0.10` to match the version
the quickstart installs. Running `pnpm peers check` no longer reports an unmet peer for this package
after a fresh install (LCMS-451).
