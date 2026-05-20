---
"@laikacms/firestore": minor
---

New package: `@laikacms/firestore`. First export
`@laikacms/firestore/storage-firestore` — a `StorageRepository` backed by
Firebase Firestore via the REST API. Walks Laika's `/`-separated keys onto
Firestore's alternating `collection / document / collection / document`
scheme: every path segment becomes a document, every folder owns an `items`
subcollection. Listing a folder is one native subcollection `GET` — no
prefix scans, no client-side filtering. Path segments are constrained to
`^[A-Za-z0-9._-]+$` (Firestore document-id rules) and rejected upfront with
a clear error otherwise. Runtime-agnostic — only depends on `fetch`.
