# Glossary

Shared vocabulary for the `laikacms` bounded context. Terms here are load-bearing: code, docs, and
ADRs use them with exactly these meanings. Background for the first three entries is in
[ADR-003](../contributing/decisions/ADR-003-cms-agnostic-protocol).

## protocol

The entire `laikacms` bounded context: the repository contracts (`DocumentsRepository`,
`AssetsRepository`, `StorageRepository`) plus the default implementations built on top of other
repositories. It knows only atoms, folders, keys, metadata, and summaries; the `content` field is
the user's own arbitrary JSON and is never interpreted. Laika minus the CMS is "basically a
protocol".

## repository

One individual contract within the protocol: documents, assets, or storage. Implementations range
from real sources (filesystem, R2, S3, WebDAV, Drizzle, Obsidian) to compositions over other
repositories (contentbase, JSON:API proxy).

## adapter

A CMS-specific integration built on repositories, also called a backend. The adapter owns every
opinionated choice its CMS needs (entry shapes, slugs, workflow states, deploy previews, commit
messages). For Decap this is the laika backend in the decap-cms repo. CMS features never move from
an adapter into the protocol; swapping one CMS's adapter for another's is a migration by design.

## version

An opaque per-record change token, exposed as the optional `version` field on documents, unpublished
records, record summaries, and assets. It changes if and only if the record's content changed, and
is comparable only by equality; it is never parsed or interpreted. A git blob or commit sha, a
database row version, and an R2 ETag are all valid implementations. Capability-gated via
`getCapabilities().versionTracking`.

## sync token

An opaque per-scope change token returned by `getSyncToken(options?)`. One token covers one scope: a
folder, or the whole store when no folder is given. It changes whenever anything inside the scope
changes, making it a cheap "did anything change?" polling primitive. A git implementation returns
the branch head sha; a database implementation returns a sequence or max(updatedAt).
Capability-gated via `getCapabilities().changes.syncToken`.

## change feed

The `listChanges({ since, folder? })` stream: enumerates what changed inside a scope since a
previously obtained sync token, as `{ key, version?, deleted }` change summaries. The stream's done
value carries the new sync token to resume from. Capability-gated via
`getCapabilities().changes.changeFeed`.

## atom / folder

The storage domain's generic vocabulary: an atom is either a storage object or a folder. These are
wrappers around the user's content, not a data model imposed on it.
