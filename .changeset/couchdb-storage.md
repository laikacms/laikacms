---
"@laikacms/couchdb": minor
---

New package: `@laikacms/couchdb`. First export `@laikacms/couchdb/storage-couchdb` — a
`StorageRepository` backed by [Apache CouchDB](https://couchdb.apache.org/) (also speaks to IBM
Cloudant and any CouchDB-protocol-compatible store). Three traits distinguish it from the rest of
the suite: (1) **first-class revisions** — every doc carries `_rev`, updates need the current rev,
stale writes get a real 409 (first true OCC mechanic in the suite); (2) **Mango selectors** as the
query DSL — `{selector: {parent: 'notes', type: 'file'}}`; (3) `POST /_bulk_docs` for atomic
multi-document writes — `removeAtoms(N)` is **two** round-trips regardless of N (one `_find`, one
`_bulk_docs`), with per-doc conflict reporting in the response. Runtime-agnostic — only depends on
`fetch`.
