---
id: ADR-003
title: Depth traversal for listAtoms/listAtomSummaries belongs in a shared helper, not per-backend
date: 2026-06-17
status: accepted
---

# ADR-003: Hoist `listAtoms` / `listAtomSummaries` depth traversal into a shared helper

## Context

`StorageRepository` (`packages/laikacms/src/domain/storage/domain/repositories/repository.ts`)
declares `listAtoms` and `listAtomSummaries` as **abstract**. Every one of the ~43 integration
backends (`packages/integrations/*/src/storage-*/`) therefore reimplements the _entire_ listing
operation — flat single-level collection, pagination, streaming, **and** the `depth > 1` recursion
that walks nested folders.

The recursion logic is identical across backends; only the "list the immediate children of one
folder" step is backend-specific. All backends are validated by a single shared contract test
(`packages/laikacms/src/domain/storage/testing/contract.ts`) that asserts, among other things, that
with `depth > 1` nested atoms surface at the parent level.

LCMS-188 surfaced as a regression of exactly this contract clause, and was being fixed one backend
at a time. With ~40 backends remaining, incremental per-backend fixing does not converge — it is
whack-a-mole over duplicated logic.

## Options Considered

1. **Hoist depth traversal into a shared helper** so backends inherit one implementation. One fix
   covers all backends; future contract changes touch one module.
2. **Split LCMS-188 into per-backend issues** to parallelize the work. Lands faster but bakes in ~43
   duplicate implementations; the next shared-contract change repeats this whole episode.
3. **Keep #476 as a single sweep PR** fixing all ~43 by hand in one branch. Converges this instance
   but leaves the duplication — same root cause survives.

## Decision

**Option 1.** The depth-recursion logic for `listAtoms` / `listAtomSummaries` MUST live in exactly
one module under `packages/laikacms/src/domain/storage/`, and every backend MUST delegate to it.

Mechanism (implementer owns the exact shape; these are the hard constraints):

- Extract the `depth > 1` folder-walking recursion + pagination/aggregate-total handling into a
  single shared helper (e.g. `collectAtomsWithDepth` / `collectAtomSummariesWithDepth`) in the
  domain storage layer.
- The helper is parameterized by a backend-supplied **flat, depth-agnostic** "list immediate
  children of one folder" function. The recursion calls that per level.
- Each backend's `listAtoms` / `listAtomSummaries` becomes a thin wrapper that supplies its flat
  lister to the shared helper. No backend reimplements depth recursion.
- Keep the existing abstract `listAtoms` / `listAtomSummaries` signatures on `StorageRepository` (do
  not break the public surface). The helper is internal plumbing, not a new abstract method, unless
  a narrow new abstract (e.g. `listFolderLevel`) is materially cleaner — that variant is acceptable
  but must be flagged in the PR body since it widens the shared base surface.

This is the real seam: the contract is shared, so its implementation is shared too.

## Consequences

- **Scope:** a refactor across the integration fleet plus the domain storage base. It touches the
  shared storage base abstractions, so it warrants careful completeness review before merge.
- **#476 disposition:** repurpose #476 into the single sweep branch implementing this ADR (or close
  it in favor of a fresh branch). It must NOT land as another single-backend fix. The per-backend
  fixes already merged stay; they get refactored to call the helper as part of the sweep.
- **Acceptance:** the shared contract test passes fleet-wide (all integration backends green on the
  `depth > 1` clause) AND `grep` shows depth recursion implemented in exactly one place.
- **Future-proofing:** the next shared-contract change to listing semantics is a one-module fix, not
  a 43-backend sweep.

This ADR supersedes the per-backend "fix the next failing backend" approach for LCMS-188.
