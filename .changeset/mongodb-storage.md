---
"@laikacms/mongodb": minor
---

New package: `@laikacms/mongodb`. First export
`@laikacms/mongodb/storage-mongodb` — a `StorageRepository` backed by
a single MongoDB collection. **Driver-agnostic** — depends on a
structural `MongoCollectionLike` interface (just `findOne`, `insertOne`,
`replaceOne`, `deleteMany`, `aggregate`, `countDocuments`) rather than
the official `mongodb` driver, so it works with any client (native
driver, Atlas Data API shim, hand-rolled mock). The interesting trait:
**aggregation pipeline as the listing DSL** —
`aggregate([{$match}, {$sort}, {$project: {content: 0}}])` — first
staged-transformation query language in the suite. `removeAtoms(N)`
packs into a single `deleteMany({_id: {$in: [...]}})`, atomic at the
collection boundary irrespective of N.
