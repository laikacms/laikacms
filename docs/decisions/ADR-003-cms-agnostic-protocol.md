---
id: ADR-003
title: The protocol stays CMS-agnostic; every CMS integrates via an opinionated adapter
date: 2026-07-16
status: accepted
---

# ADR-003: The protocol stays CMS-agnostic; every CMS integrates via an opinionated adapter

**Date:** 2026-07-16 **Status:** Accepted **Deciders:** Sem Postma

A mirror of this decision, written from the Decap side, lives in the decap-cms repo as
`docs/architecture/two-seam-model.md`.

## Context

Two forces pull in opposite directions:

1. Prospective users push back on the idea that adopting Laika means adopting Laika's domain model:
   that they must define their schemas and fields "in Laika's format". This is a misconception, and
   the fact that we keep having to correct it means the architecture was not communicating it.
2. Any CMS frontend has strong opinions. Decap, today's frontend, expects entry shapes, slugs,
   editorial workflow states, media folders, deploy previews, and commit messages. If those opinions
   leak into the protocol, the protocol stops being reusable for other CMS frontends and forces one
   CMS's model onto every source.

## Decision

Content flows through two seams, and each seam has a strict owner:

```
source domain          laikacms protocol           CMS adapter              user
(git, DynamoDB,   <->  (repositories: atoms,  <->  (laika-decap-       <->  (interacts with
 Cognito, R2, ...)      folders, keys, meta-        backend: opinion-        their ORIGINAL
                        data, summaries;            ated field/shape         domain model)
                        content = opaque JSON)      expectations)
```

**Seam 1: source domain to protocol.** The protocol is the whole `laikacms` bounded context: the
repository contracts (`DocumentsRepository`, `AssetsRepository`, `StorageRepository`) plus the
default implementations built on top of other repositories. It knows only atoms, folders, keys,
metadata, and summaries. The `content` field is an arbitrary JSON object owned by the user's own
domain; the protocol never interprets it. Prospects who believe they must adopt Laika's domain model
are wrong, and this ADR is the place to point them: Laika wraps their JSON, it does not replace it.
A database is just a storage repository with no folders where the IDs are keys.

**Seam 2: protocol to CMS.** Each CMS gets its own adapter that makes the opinionated choices about
which fields and conventions it expects. For Decap that adapter is the laika backend in the
decap-cms repo (`packages/decap-cms/src/backends/laika/`). Another CMS frontend would get its own
adapter with its own (probably different) opinions.

## Consequences

- **CMS-specific features live in adapters, never in the protocol.** Deploy previews, commit
  messages and authors, and open authoring are Decap concerns. The Decap adapter decides how (and
  whether) to express them. The protocol does not grow endpoints for them.
- **Cross-cutting infrastructure concerns go in the protocol, generically.** Version tracking and
  change signals (added together with this ADR) are the canonical example:
  - an opaque per-record `version` string on documents, unpublished records, summaries, and assets
    (a git blob sha, a database row version, and an R2 ETag are all valid implementations);
  - a per-scope sync token (`getSyncToken`) that changes whenever anything inside the scope (a
    folder, or the whole store) changes;
  - an optional change feed (`listChanges`) that enumerates what changed since a token.

  All of it is capability-gated via `getCapabilities()` (`versionTracking`, `changes`) and named in
  domain-neutral terms. Nothing git-flavored crosses the seam.
- **Swapping CMS frontends requires a migration.** Because every adapter is opinionated in its own
  way, you cannot swap one CMS for another without migrating. This is accepted and intended: it
  keeps each adapter honest and each CMS integration natural, instead of forcing a
  lowest-common-denominator model on everyone.
- **Users keep their own domain model.** The content field is their JSON. Laika wraps it; it does
  not replace it.

## Terminology

Recorded in the [glossary](../glossary.md). The two load-bearing terms:

- **protocol**: the entire `laikacms` bounded context, repository contracts plus default
  implementations. Laika minus the CMS is "basically a protocol".
- **repository**: one individual contract within the protocol (documents, assets, storage).

## Options considered

### Option 1: grow the protocol to cover CMS features

Add deploy previews, commit metadata, and workflow opinions to the repository contracts so any CMS
gets them "for free". Rejected: it turns the protocol into a union of every CMS's opinions, makes
every non-git source pretend to be git, and confirms the misconception that adopting Laika means
adopting a foreign domain model.

### Option 2: one neutral protocol per CMS feature set

Define a lowest common denominator that all CMS frontends must fit. Rejected: lowest common
denominator models serve nobody well, and the pressure to extend them never ends.

### Option 3 (chosen): CMS-agnostic protocol, opinionated adapters

The protocol stays small and generic; each CMS adapter is free to be as opinionated as its CMS
needs. Cross-CMS moves are explicit migrations.
