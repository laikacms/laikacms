---
id: LEARN-004
title: As a library, the interface is the product — hold it to a higher standard
source: distilled from the 2026-08-05 locks-redesign design session (see ADR-007)
date: 2026-08-06
---

# As a library, the interface is the product

The document-locking redesign (ADR-007) was **not** triggered by a bug. The old `LockStore` _worked_
for single-node advisory locking. We replaced it because **we are a library**: every interface we
publish is a decision made once, for every user, and effectively forever — changing it later is a
breaking change for all of them. That raises the bar from "does it work" to "is it right, and right
for the future." This note is what that bar looked like in practice.

## We decide the interface for everyone — so design for the future, not the present

A KV seam (`get`/`set`/`delete`) runs fine. But it pushes all lock _policy_ onto every future
backend author and can't express _intent_ — an atomic acquire, a native transaction. As the library
we own that seam for backends that don't exist yet (Redis, Postgres, a git-ref CAS). The higher
standard was to move the seam to the **semantic operation** (`acquire`/`refresh`/`release`/`get`) so
each backend expresses its own native guarantee. The implementation can stay simple (an in-memory
STM default); the _interface_ is what must be near perfect, because implementations are swappable
and a published interface is not.

## Open for extension, closed for modification

The most valuable moves in the session were the ones that let future needs **extend** the shape
without **modifying** it:

- **`precondition: { ifVersion?, ifLockHeldBy? }`** as a struct, not a bare `ifVersion` string — one
  slot that already holds two preconditions and absorbs future ones (`ifExists`,
  `ifUnmodifiedSince`) with no breaking change.
- **Capabilities carry axes, never a bare boolean** — `locks: { supported, scope, transactional }`.
  A new guarantee becomes a new field, not a new shape. (A bare `supported: boolean` would force a
  breaking change the moment a second axis — cross-node reach, transactionality — appears.)
- **Shared lock types, Documents-only methods** — Assets/Storage adopt the identical vocabulary
  later without re-derivation.
- **Reuse existing idioms** — `/documents/:key/lock` mirrors `/sync-token` and `/changes`; the
  version rung reuses `VersionMismatchError`; the default follows the `subscribeChanges` capability
  template. Consistency _is_ extensibility: a capability that looks like the ones already there is
  one the ecosystem already knows how to consume.

## Consistency of vocabulary: authentication vs authorization

A recurring win was catching where **authentication** (who you are) was standing in for
**authorization** (what you may do). The enforcement seam was made **identity-free**: a write does
not prove _who_ it is — it presents an unforgeable **lock token** that _authorizes_ the write. Owner
name/id stays for display only. Naming the two concepts correctly and separating them made the seam
smaller and more honest, and it echoes the recent authentication/authorization split in `decap-api`.
Precise words produce precise interfaces.

## The bar: a polished interface, even ahead of a polished implementation

We are not shipping "something that works" — we're shipping something as close to right as we can
make it _at the interface_, with respect to the future. The STM lock manager is a plain default;
what we held to a near-perfect standard is the contract around it: the seam, the capability axes,
the error semantics (**rollback ⇒ the call fails**), the token as an authorization capability.
Implementations improve release over release; the interface is the promise we can't cheaply take
back.

Relates to [[LEARN-005 - prune-deps-when-responsibility-moves-out]] — both are facets of not letting
the published shape misrepresent what it is.
