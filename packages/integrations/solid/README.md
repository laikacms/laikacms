# @laikacms/solid

[Solid Pod](https://solidproject.org/) / [Linked Data Platform](https://www.w3.org/TR/ldp/)-backed
implementation of Laika CMS contracts. First (and current) export:
**`@laikacms/solid/storage-solid`** — a `StorageRepository` over an LDP-compatible Solid Pod.

Runtime-agnostic — only depends on `fetch`. Ships with a focused Turtle parser for the LDP
container-listing format; no external RDF library required.

```bash
pnpm add @laikacms/solid
```

## Why a Solid Pod package

Solid is a decentralised web specification — every user has a Personal Online Datastore (a "Pod")
with resources at HTTPS URIs and hierarchical containers. Five architectural traits set it apart
from every other backend in the Laika suite:

**1. URI-as-identity.** Every resource IS its URL —
`https://alice.pod.example/laika/notes/hello.md`. No opaque object ids, no `(table, id)` tuples. The
URL is the canonical handle and surfaces in `metadata.revisionId`.

**2. Trailing-slash addressing.** `<pod>/notes/` (with `/`) is an LDP container; `<pod>/notes.md`
(without) is a resource. **First backend in the suite where the URL itself disambiguates file vs
folder.**

**3. RDF/Turtle wire format for container listings.** `GET <container/>` with `Accept: text/turtle`
returns a Turtle document whose `ldp:contains` triples enumerate the children:

```turtle
@prefix ldp: <http://www.w3.org/ns/ldp#>.

<> a ldp:BasicContainer, ldp:Container;
   ldp:contains <hello.md>, <world.md>, <notes/>.

<hello.md> a ldp:Resource.
<notes/>   a ldp:BasicContainer.
```

The package ships a focused Turtle parser (`turtle.ts`) that handles the LDP subset — `@prefix`
declarations, prefixed names, IRI refs, the `a` keyword, `;` and `,` continuation — and resolves
relative IRIs against the document base. **First triple-store backend in the suite.**

**4. Content negotiation via `Accept` headers.** Different resources speak different formats — file
content is `text/markdown` or `application/json`, container metadata is `text/turtle`, ACLs are
`text/turtle` at a sibling `.acl` URI. **First content-negotiation backend in the suite.**

**5. `If-None-Match: *` for create-only PUTs.** The repository emits this header on `createObject` —
first time HTTP precondition semantics become the OCC primitive in the Laika suite. 412 Precondition
Failed → `EntryAlreadyExistsError`.

## What this backend is NOT distinguished by

`removeAtoms(N)` does **not** pack into a single round-trip — LDP has no native bulk-delete
primitive, and SPARQL UPDATE isn't part of the core Solid spec. The repository issues N parallel
DELETEs. If your Solid implementation supports SPARQL UPDATE (Apache Jena Fuseki, GraphDB), you can
layer that on top.

## Usage

```ts
import { SolidDataSource, SolidStorageRepository } from '@laikacms/solid/storage-solid';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new SolidDataSource({
  podRoot: 'https://alice.solidcommunity.net/laika/', // MUST end with `/`
  auth: {
    accessToken: process.env.SOLID_ACCESS_TOKEN!,
    // …or:
    tokenProvider: async () => obtainDpopBoundAccessToken(),
    // For Solid-OIDC, supply the per-request DPoP proof via headers:
    headers: { DPoP: '...' },
  },
});

const repo = new SolidStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## URL layout

```
<podRoot>                       — root container
<podRoot>notes/                 — LDP basic container (Laika folder)
<podRoot>notes/hello.md         — LDP RDF resource (Laika file)
<podRoot>notes/.acl             — WAC ACL (out of scope for v1)
```

## Operation mapping

| Laika operation             | LDP call(s)                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `getObject(key)`            | N × parallel `HEAD` (probe extensions) + 1 × `GET`                                                           |
| `createObject(key, …)`      | N × `HEAD` (probe) + M × `PUT` (auto-create ancestor containers) + 1 × `PUT` (file, with `If-None-Match: *`) |
| `updateObject(key, …)`      | N × `HEAD` (resolve) + 1 × `PUT` (replace)                                                                   |
| `createOrUpdateObject`      | N × `HEAD` + 1 × `PUT`                                                                                       |
| `createFolder(key)`         | M × `HEAD` + M × `PUT` (Content-Type: text/turtle)                                                           |
| `removeAtoms([k₁…kₙ])`      | n × `HEAD` (resolve) + **n × parallel `DELETE`** (no bulk primitive)                                         |
| `listAtomSummaries(folder)` | 1 × `GET` container with `Accept: text/turtle` + Turtle parse                                                |
| `getCapabilities()`         | (no I/O — static)                                                                                            |

## Auth

Solid uses Solid-OIDC — a Solid-specific OAuth 2.0 / OpenID Connect profile that adds DPoP-bound
access tokens. The data source takes a pre-acquired access token; DPoP proof generation lives
outside this layer (use `@inrupt/solid-client-authn-*` or your own implementation):

```ts
new SolidDataSource({
  podRoot,
  auth: {
    accessToken: dpopBoundAccessToken,
    headers: {
      // DPoP proofs are per-request, JWT-encoded; refresh via your
      // headers hook on every call. The structural shape is the same.
      DPoP: 'eyJ...',
    },
  },
});
```

For test pods (CommunitySolidServer with anonymous access), omit `auth.accessToken` entirely — most
public test pods accept unauthenticated PUTs on `/public/` paths.

## Caveats

- **WAC ACLs aren't managed by this package.** Solid uses Web Access Control (WAC) — `.acl` files
  alongside resources — for permissions. The repository's `.keep`-style ignore list excludes `.acl`
  and `.meta` resources from listings, but does not create or modify them.
- **DPoP proof refresh lives outside the data source.** Every Solid request bound to a DPoP key
  needs a fresh proof; supply this via `auth.headers` (callable per request) or `tokenProvider`.
- **Pagination uses Link headers (RFC 5988) in real LDP servers.** Not yet pushed down — the
  repository fetches the full container listing in one shot and slices in memory.
- **Turtle parser is LDP-subset only.** Blank nodes, RDF collections (`( ... )`), and typed literals
  beyond simple strings aren't handled. If your pod emits more elaborate Turtle, layer `n3` /
  `rdflib.js` inside the `SolidDataSource.listContainer` override.
