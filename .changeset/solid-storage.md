---
"@laikacms/solid": minor
---

New package: `@laikacms/solid`. First export
`@laikacms/solid/storage-solid` — a `StorageRepository` backed by a
[Solid Pod](https://solidproject.org/) / Linked Data Platform server.
Five architectural traits distinguish it from the rest of the suite:
(1) **URI-as-identity** — every resource IS its URL, no opaque ids;
(2) **trailing-slash addressing** — `<pod>/notes/` is a container,
`<pod>/notes.md` is a resource; first backend where the URL
disambiguates file vs folder; (3) **RDF/Turtle wire format for
container listings** — `ldp:contains` triples parsed by the
package's focused Turtle parser (LDP subset of RFC 3987). **First
triple-store backend in the suite**; (4) **content negotiation via
`Accept` headers** — different formats per resource type; (5)
**`If-None-Match: *` for create-only PUTs** — HTTP precondition
semantics as the OCC primitive (412 Precondition Failed →
`EntryAlreadyExistsError`). Ancestor containers are auto-created
since LDP requires parent containers to exist before adding
children. Honest about what's *not* here: LDP has no native
bulk-delete primitive, so `removeAtoms(N)` does N parallel DELETEs;
this is the first backend that doesn't add a new atomic-multi-write
mechanism (the loop's 14th distinct architecture, but not the 14th
distinct atomicity model). Runtime-agnostic — only depends on
`fetch`.
