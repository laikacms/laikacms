# Contributing

**Removing code is more valuable than adding code.**

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

## Local CI gate (husky hooks)

CI checks run locally via husky — there are no GitHub Actions check workflows.

| Hook         | What runs                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `pre-commit` | `pnpm format:check`, `pnpm lint`                                                                    |
| `pre-push`   | `pnpm typecheck`, `pnpm lint`, `pnpm test --passWithNoTests`, trufflehog secret scan (if installed) |

Hooks are installed automatically by `pnpm install` (via the `prepare` script).

To install trufflehog for secret scanning:
https://github.com/trufflesecurity/trufflehog#installation. It is optional — the pre-push hook skips
the scan if `trufflehog` is not on `PATH`.

## Quickstart smoke test (manual)

`browser-sim/` drives `docs/quickstart-fs-decap.md` end-to-end — a fresh npm and pnpm install from
the public registry, the esbuild bundle, the server, and a headless Chromium check that the Decap
admin UI actually renders. It is **not** part of `pnpm test`: it hits the network and takes minutes,
so it stays out of the per-commit gate. Run it by hand whenever you change the quickstart:

```bash
cd browser-sim
npm install && npx playwright install chromium
npm run smoke:quickstart          # or: node quickstart-smoke.mjs --npm-only | --pnpm-only
```

## Guidelines

- Use `workspace:*` for internal dependencies
- Use `catalog:` references for shared dependencies
- Follow [Conventional Commits](https://www.conventionalcommits.org/)
- Run `pnpm lint` and `pnpm format` before committing

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
