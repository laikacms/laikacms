---
"@laikacms/etcd": minor
---

New package: `@laikacms/etcd`. First export
`@laikacms/etcd/storage-etcd` — a `StorageRepository` backed by an
etcd v3 cluster via the gRPC JSON gateway. Three architectural traits
distinguish it from the rest of the suite:
(1) **base64-encoded keys/values on the wire** — etcd's gateway is
JSON-over-HTTP but every key/value field is base64; first backend in
the loop with a binary-wire-format encoding step;
(2) **prefix scans via `[key, range_end)` pairs** — no `?prefix=`
parameter, you compute `range_end` by incrementing the last byte
(`/notes/` → `/notes0`), exposed by the `prefixRangeEnd()` helper;
(3) **`Txn` as the atomic primitive** — `createObject` uses CAS
(`compare: createRevision == 0` + `success: [requestPut]`),
`removeAtoms(N)` packs N `requestDeleteRange` ops into one
`Txn.success` array — the 7th structurally distinct atomic-multi-write
mechanism in the suite. Real MVCC revisions surface as `revisionId`.
Runtime-agnostic — only depends on `fetch`.
