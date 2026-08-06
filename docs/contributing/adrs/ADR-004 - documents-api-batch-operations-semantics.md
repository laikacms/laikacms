---
id: ADR-004
title: documents-api POST /operations — fail-fast batch semantics, not JSON:API atomic operations
date: 2026-07-12
status: accepted
---

# ADR-004: `documents-api` POST `/operations` — fail-fast batch semantics, not JSON:API atomic operations

**Date:** 2026-07-12 **Status:** Accepted **Deciders:** LaikaCMS maintainers

## Context

`POST /operations` in `packages/laikacms/src/api/documents-api/server.ts` accepts an
`atomic:operations` array and returns `atomic:results`, borrowing the vocabulary of the **JSON:API
Atomic Operations extension**, whose contract is all-or-nothing:

> "If any operation fails, the server MUST NOT process any subsequent operations, and MUST roll back
> the effects of any previously processed operations."

The implementation honours **neither** clause. It `.map()`s each op to an independent `LaikaResult`,
applies every one regardless of earlier failures, and returns HTTP `200` even when some ops errored.
A partially-failing batch leaves the repository **partially mutated** while the response advertises
an extension that promises the opposite. A client trusting the extension corrupts its own state.

This is long-standing behaviour — LCMS-401 (#695) did not introduce it — but #695's new mixed-batch
tests now _pin_ it, so the cost of changing it only grows.

LCMS-402 framed the call as a binary: **(1)** make it genuinely atomic (transaction + rollback,
breaking), or **(2)** keep per-op semantics and drop the `atomic:*` vocabulary (cheap).

## Ground truth established before deciding

Measured on `origin/develop`, 2026-07-12:

1. **There is no transaction primitive anywhere in the codebase.**
   `grep -ilE "transaction|rollback"` over every non-test `.ts` in `packages/**` returns **zero**
   hits. Not in the repository interfaces, not in any impl, not in the domain base abstractions.
2. **Most shipped backends physically cannot transact.** The storage/documents surface includes
   `storage-fs`, `storage-s3`, `storage-webdav`, `storage-r2`, `assets-obsidian`, `git-gateway`.
   Object stores and filesystems have no multi-key transaction to reach for. Only the SQL-backed
   impls (`drizzle`, `libsql`) could offer one.
3. **The endpoint never negotiated the extension.** There is no `ext=` media-type parameter handling
   anywhere (`grep -inE "ext=|application/vnd\.api.*ext"` → nothing). The API borrows the
   extension's _member names_ without ever performing the JSON:API extension negotiation that would
   entitle a client to its guarantees.
4. **The wire surface has zero in-repo consumers.** `atomic:operations` / `atomic:results` appear
   only in the endpoint itself, its OpenAPI schema, its own tests, and `docs/api-reference.md`. The
   Decap backend does not call `/operations`. Renaming the members breaks **no** internal caller.

## Decision

**Neither option as written. Take the achievable half of the spec contract and stop advertising the
half we cannot honour.** Three parts, all required:

**(a) Pre-flight validation pass — validate the whole batch before applying any op.** Any
_request-shape_ failure (missing `data.id`, unknown `op`, bad `type`) ⇒ HTTP `400`, **zero writes**,
an `errors` array naming the offending op index. This costs nothing: request validation is pure,
needs no transaction, and happens before any I/O. It also makes the batch genuinely all-or-nothing
for the **realistic** failure mode — a malformed client payload — and it retires the entire bug
class that LCMS-393 / 397 / 398 / 401 have been patching one branch at a time.

**(b) Stop on first error during application.** Once an op fails, do not process subsequent ops.
This is the "MUST NOT process any subsequent operations" clause, and it is free.

**(c) Drop the `atomic:*` vocabulary.** Rename the request/response members and the endpoint
description away from the extension's namespace (e.g. `operations:` / `operations:results`), and
state the remaining deviation **explicitly** in the OpenAPI description, the package README, and
`docs/api-reference.md`: _a mid-batch repository failure leaves previously-applied ops applied; this
endpoint is a fail-fast batch, not a transaction._

### Why not option 1 (genuine atomicity)

It requires a transaction primitive in the base repository abstraction (a shared base abstraction)
that a majority of shipped backends cannot implement. The fallback — apply-and-compensate — is
**unsound**: the compensating write can itself fail, and there is no isolation, so concurrent
readers observe intermediate state. "Atomic except when the rollback also breaks" is a worse lie
than the current one. Capability-gating atomicity to SQL backends only (the `DocumentsCapabilities`
mechanism could express it) is a large multi-package change to `packages/domain` base abstractions,
disproportionate to a never-consumed endpoint, and would still leave the majority of backends
non-atomic — i.e. it does not actually let us keep the `atomic:*` promise.

### Why not option 2 as written

Option 2 renames but leaves per-op semantics fully intact, so a malformed batch still half-applies.
That leaves free spec-compliance on the table: (a) and (b) cost nothing and eliminate the failure
mode clients will actually hit.

## Consequences

- **Wire-breaking on paper, inert in practice.** The member rename changes the public JSON:API
  surface, but no internal caller and no negotiated client exists (facts 3 + 4).
- The mixed-batch tests added in #695 **invert**: a batch with a bad op must now write nothing and
  return `400`, not `200` with a partial `atomic:results`.
- Honest OpenAPI: the endpoint stops claiming a contract the storage layer cannot back.
- A future transactional-backend capability (`DocumentsCapabilities.transactions`) remains open if
  it is ever wanted; this ADR does not foreclose it, it declines to build it now.
- The resulting PR touches the JSON:API public surface in `packages/api`, so it warrants maintainer
  review before merge.

## Implementation

Tracked by **LCMS-402**, whose acceptance criteria are rewritten to this decision.

---

## Amendment — 2026-07-12: the rename ships as a **major**, not a minor

Recorded at merge time of [#696](https://github.com/laikacms/laikacms/pull/696).

This ADR justified the clean break (dropping `atomic:*` rather than aliasing it) on the finding that
there are **zero in-repo consumers** of the documents-api `/operations` vocabulary. That finding is
correct and was re-verified at merge: the Decap backend does not call `/operations`, and
`storage-jsonapi-proxy` posts `ref: { type: "atom" }` — the **storage-api** vocabulary, whose
`/operations` endpoint this ADR deliberately leaves untouched.

**But "no in-repo consumers" is not "no consumers."** `laikacms` is published on npm (1.1.0) and
`./documents/api` is a **public export**. Downstream users stand up this server and point their own
HTTP clients at it; the `atomic:operations` → `operations` rename breaks those clients. The PR
originally carried a `minor` changeset, which would have let them auto-upgrade on `^1.x` into a
silent 400.

That is the _same_ failure mode this ADR was written to eliminate — advertising a contract we do not
honour — merely relocated from the wire to the package version. Semver is the only contract we have
with an external consumer, so the changeset was corrected to **`major`** before merge, with a
migration note.

**Standing rule this establishes:** a breaking change to any HTTP surface reachable through a public
export of a published package is a **major** bump, even when the TypeScript export _signatures_ are
unchanged. The npm version is the only signal an external consumer gets. If the project does not
want a major release, the honest lever is back-compat (accept both keys for a deprecation window) —
never a mislabelled bump.
