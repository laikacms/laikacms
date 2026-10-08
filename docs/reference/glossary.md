# Glossary

Shared vocabulary for the `laikacms` bounded context. Terms here are load-bearing: code and docs use
them with exactly these meanings. Background for the first three entries is in
[Architecture](../concepts/architecture).

## local mode

The `@laikacms/vite-plugin` is running under `vite dev` **and** `localApi: true` is set. In local
mode the plugin mounts LaikaCMS's own JSON:API under `/__laika` on the Vite dev server so a JSON:API
client (e.g. the Decap admin) can read and write content without a remote backend. The API is
unauthenticated by design and only ever live while the dev server is running — a production build
has no route to it.

See [Local Mode Dev Editing](../guides/decap/local-mode) and [Vite plugin](../guides/vite).

## remote mode

The opposite of local mode: the admin communicates with a deployed LaikaCMS API (e.g. a Hono server
or a Cloudflare Worker). The Vite dev server may or may not be running; the distinguishing factor is
that content reads and writes go to a remote HTTP endpoint, not to `/__laika` on localhost.
`resolveLaikaBackend` selects remote mode whenever `import.meta.env.DEV` is not truthy.

## protocol

The entire `laikacms` bounded context: the repository contracts
([`DocumentsRepository`](./api/laikacms/documents/classes/DocumentsRepository),
[`AssetsRepository`](./api/laikacms/assets/classes/AssetsRepository),
[`StorageRepository`](./api/laikacms/storage/classes/StorageRepository)) plus the default
implementations built on top of other repositories. It knows only atoms, folders, keys, metadata,
and summaries; the `content` field is the user's own arbitrary JSON and is never interpreted. Laika
minus the CMS is "basically a protocol".

## repository

One individual contract within the protocol: documents, assets, or storage. Implementations range
from real sources (filesystem, R2, S3, WebDAV, Drizzle, Obsidian) to compositions over other
repositories (catalog, JSON:API proxy).

## catalog

The opinionated layer of the protocol: the named collections — document folders and media folders —
that a store's content is organised into, each with a directory, an optional JSON Schema, and (for
media) accepted content types. The contract is
[`CatalogProvider`](./api/laikacms/catalog/classes/CatalogProvider); `laikacms/documents/catalog`
and `laikacms/assets/catalog` are the repositories that project those collections onto generic
[atoms and folders](#atom--folder). A catalog is optional: a backend can implement
`DocumentsRepository` directly and never expose one.

Where a catalog is persisted is the provider's business, not the contract's.
`laikacms/catalog-convention` keeps it in storage under `.laika/` (`.laika/catalog`,
`.laika/schemas/<collection>`, `.laika/revisions/<collection>`); `laikacms/catalog-decap` derives it
from a Decap config object; a DynamoDB provider has no path at all. Those keys are deliberately
extensionless so the storage repository's configured serializers decide the on-disk format.

Not to be confused with pnpm's `catalog:` dependency protocol, which this repo also uses — that one
is a package-manager concern and never appears in library code.

## adapter

A repository implementation for one specific service: a `StorageRepository`, `DocumentsRepository`,
or `AssetsRepository` backed by R2, the filesystem, a git host, a SQL database, and so on. Adapters
are interchangeable behind their contract; everything above the repository works unchanged whichever
one is plugged in. See [Adapters](../adapters/) for the full list.

## CMS integration

The CMS-specific layer built on repositories. It owns every opinionated choice its CMS needs (entry
shapes, slugs, workflow states, deploy previews, commit messages). For Decap this is the laika
backend in the decap-cms repo. CMS features never move from a CMS integration into the protocol;
swapping one CMS's integration for another's is a migration by design. ADR-006 predates this term
and calls it an "adapter".

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

## LaikaTask / LaikaStream

The two return types every repository method uses: `LaikaTask<T>` for a single result and
`LaikaStream<T, D>` for many results with a typed done value. Both are thin, Effect-based
abstractions — internally they are Effects, so they carry the typed error channel, tracing, and
interruption semantics Effect provides, and an Effect consumer can `yield*` them directly inside an
`Effect.gen`.

They are deliberately **not** raw `Effect` values. Wrapping Effect behind
[`LaikaTask`](./api/laikacms/core/namespaces/LaikaTask/)/[`LaikaStream`](./api/laikacms/core/namespaces/LaikaStream/)
keeps Effect an implementation detail of the protocol rather than a hard requirement on the caller:
the library can be consumed with or without adopting Effect. See [dual API](#dual-api).

API reference: [`LaikaTask`](./api/laikacms/core/namespaces/LaikaTask/) and
[`LaikaStream`](./api/laikacms/core/namespaces/LaikaStream/).

## dual API

A design rule: `laikacms` is built on Effect internally, but must be usable by consumers who do not
use Effect. Repository methods therefore return [LaikaTask / LaikaStream](#laikatask--laikastream)
(Effect-based, for Effect consumers) while `laikacms/compat` exposes Promise-friendly wrappers for
everyone else:

- **`runTask(task, options?)`** runs a `LaikaTask` and resolves with its value.
- **`collectStream(stream, options?)`** drains a `LaikaStream` and resolves with its items and done
  value.

Neither wrapper requires the caller to import Effect. This is intentional and load-bearing: new code
must preserve it. Do not expose a raw `Effect` type across a public repository boundary, and do not
force callers into an Effect runtime to use a repository — anything reachable via `LaikaTask` /
`LaikaStream` must stay consumable through `laikacms/compat`.
