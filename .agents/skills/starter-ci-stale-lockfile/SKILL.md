---
name: starter-ci-stale-lockfile
description: Use when a starter-*-blog PR's `ci` check fails with ERR_PNPM_OUTDATED_LOCKFILE or frozen-lockfile errors. This is a stale-branch mechanical fix, not a product bug — do not debug app code.
version: 1.0.0
---

# Starter PR CI: stale pnpm lockfile

## Overview

Long-lived `starter-*-blog` PR branches go stale against `develop`. When `develop`'s
`pnpm-lock.yaml` advances (a dependency added/bumped anywhere in the monorepo), the CI install
step runs `pnpm install --frozen-lockfile` and fails fast (typically 5–15s) with:

```
ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not
up to date with <ROOT>/apps/starter-<x>/package.json
```

This is a **mechanical staleness failure**, not a defect in the starter. Do **not** read the
starter's app code, tests, or config looking for the cause — the cause is the branch being behind
`develop`. A fast-failing `ci` job (seconds, not minutes) with this error is the tell.

## When to Use

- A `starter-*-blog` PR's `ci` check is red **and** the failing log contains
  `ERR_PNPM_OUTDATED_LOCKFILE` or `frozen-lockfile`.
- The `ci` job fails in seconds at the install step (before tests/build run).

## When NOT to Use

- The `ci` job runs for minutes then fails — that is a real test/build failure, handle it as a
  product issue (and respect any active integration hold, e.g. LCMS-028).
- `trufflehog` is the failing check — that is the secret-scan path, unrelated to lockfiles.

## Fix

Rebase the branch onto `develop` and regenerate the lockfile at the repo root:

```bash
git fetch origin
git rebase origin/develop            # resolve conflicts if any; lockfile conflicts are expected
pnpm install                         # at repo ROOT — regenerates pnpm-lock.yaml to match develop
git add pnpm-lock.yaml
git commit -m "chore: rebase onto develop, regenerate pnpm-lock.yaml"
git push --force-with-lease
```

Notes:

- Run `pnpm install` **without** `--frozen-lockfile` so it rewrites the lockfile; commit the
  regenerated `pnpm-lock.yaml`.
- If the rebase produces a `pnpm-lock.yaml` conflict, take `develop`'s side then re-run
  `pnpm install` to reconcile the starter's `package.json` — don't hand-merge the lockfile.
- One `pnpm install` at the root covers the whole workspace; do not run it per-app.
- After push, wait for the fresh `ci` run; if it now fails in the test/build phase, that's a
  separate (product) problem — see "When NOT to Use".
