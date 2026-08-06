---
id: ADR-003
title: Repository Effect boundary convention (LaikaTask target style)
date: 2026-07-04
status: accepted
---

# ADR-003: Repository Effect boundary convention (LaikaTask target style)

**Date:** 2026-07-04 **Status:** Accepted **Deciders:** LaikaCMS maintainers

## Context

LCMS-001 ("Convert StorageRepository return types to LaikaTask end-to-end") had been `blocked` on a
question framed as a binary architecture choice:

> Is **async-generator + `effect/Result`** the accepted final `LaikaTask`/`LaikaStream` shape, or
> should repository bodies be migrated to **`Effect.gen` + `Effect.tryPromise`** at datasource
> boundaries?

A ground-truth check on `origin/develop` (2026-07-04) showed the dichotomy is **false**:

- **Every** impl repository already returns `LaikaTask`/`LaikaStream` built with
  `LaikaTask.make(...)` / `LaikaStream.make(...)` wrapping `Effect.gen(function*() { ... })`. There
  is no surviving "async-generator + raw `Result`" body style to choose between — everything is
  already `Effect.gen`.
- The **only** real variation is how each impl bridges its datasource Promise:
  - **`storage-drizzle`** (`impl/storage-drizzle/storage-repository.ts`) uses the inline boundary
    primitives directly: `Effect.tryPromise({ try, catch })`, `Effect.promise(...)`,
    `yield* Effect.fail(...)`, `Effect.result(...)` + `emit.recoverableError(...)`.
  - **5 files** — `storage-r2`, `storage-fs`, `storage-webdav`, `assets-obsidian`, `assets-r2` —
    still route through a local `liftResult` shim
    (`Effect.flatMap(Effect.promise(p), Effect.fromResult)`) because their datasources already
    return `Promise<LaikaResult<A>>`.

Both are `Effect.gen`-based `LaikaTask`s; `liftResult` is a two-line convenience, not a competing
architecture. No deeper architecture decision is actually required.

## Decision

1. **Canonical target style.** Repository implementations return `LaikaTask.LaikaTask<T>` /
   `LaikaStream.LaikaStream<T, Done>` constructed via `LaikaTask.make(...)` /
   `LaikaStream.make(...)` wrapping `Effect.gen(function*() { ... })`. At the datasource boundary:
   - Promise that may reject → `Effect.tryPromise({ try, catch })`.
   - Infallible promise → `Effect.promise(...)`.
   - Domain error → `yield* Effect.fail(new <SpecificError>(...))`.
   - Per-item recoverable handling in streams → `Effect.result(...)` + `emit.recoverableError(...)`.

   **Reference implementation:** `packages/laikacms/src/impl/storage-drizzle/storage-repository.ts`.

2. **`liftResult` is an accepted local convenience, not a defect.** Where a datasource already
   returns `Promise<LaikaResult<A>>`, `liftResult` is a legitimate boundary bridge and MAY remain.
   New code SHOULD prefer the inline `Effect.tryPromise` boundary for consistency with the
   reference, but eradicating `liftResult` is a cosmetic cleanup, not a correctness or blocking
   concern.

3. **`LaikaResult` / `effect/Result` stay.** They remain the internal result type used by the API
   layer and serializers (out of scope for LCMS-001).

## Consequences

- **LCMS-001 is unblocked.** It is not an architecture fork. Its residual scope is a bounded, P3
  consistency cleanup: migrate the 5 `liftResult` remnants to inline `Effect.tryPromise` boundaries
  per the `storage-drizzle` reference, then delete the helper — OR close as "won't do" since
  `liftResult` is now explicitly accepted.
- **LCMS-003 proceeds.** Its dependency on LCMS-001 was "follow the `LaikaTask` precedent
  `StorageRepository` set" — that precedent already exists on `develop` (`StorageRepository` methods
  already return `LaikaTask`), so the dep is satisfied.
- Future impl authors have a written convention and a named reference, so this ambiguity should not
  recur.
