# Landing a PR

## Branch naming

`<type>/lcms-<issue-number>-<short-slug>`, e.g. `feat/lcms-453-contributing-onboarding-guide` or
`fix/lcms-282-strip-type-from-session-attrs`. `<type>` matches the
[commit convention](#commit-convention) below. If there's no tracked issue, drop the issue number:
`<type>/<short-slug>`.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, optionally
referencing the issue and PR, e.g.:

```
fix(assets-contentbase): remap EntryAlreadyExistsError detail to domain key (LCMS-283) (#871)
docs(quickstart-fs-decap): pin @hono/node-server to ^2 in §1 install (LCMS-268) (#873)
```

Common types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`. `scope` is usually the package or
subpath you changed (`assets-contentbase`, `quickstart-fs-decap`, …).

## Changesets

If your change affects a published package's behavior (`laikacms` or `@laikacms/decap`), add a
changeset:

```bash
pnpm changeset
```

This walks you through picking the bump type (patch/minor/major) and writing a summary; it writes a
markdown file under `.changeset/`. Both packages are version-fixed (`.changeset/config.json`'s
`fixed` group), so they always bump together. Docs-only, test-only, or internal-tooling changes
typically don't need one — see `.changeset/README.md` for the full rules.

## Before you push

Run the same checks the `pre-push` hook runs:

```bash
pnpm typecheck
pnpm lint
pnpm test -- --passWithNoTests
```

## Local CI gate (husky hooks)

There are no GitHub Actions check workflows on pull requests — CI runs locally via husky hooks, so a
clean `git push` from your machine is the real gate:

| Hook         | What runs                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `pnpm format:check`, `pnpm lint`                                                                         |
| `pre-push`   | `pnpm typecheck`, `pnpm lint`, `pnpm test -- --passWithNoTests`, a trufflehog secret scan (if installed) |

Hooks are installed automatically by `pnpm install` (the root `prepare` script runs `husky`). The
trufflehog scan is optional — the hook skips it if `trufflehog` isn't on `PATH`. See
[trufflehog's install docs](https://github.com/trufflesecurity/trufflehog#installation) to add it.

## Opening the PR

Open the PR against `develop`. Reference the issue in the title or description (`LCMS-<n>`) so it
can be tracked. There's no PR template beyond that — a short "what and why" is enough.
