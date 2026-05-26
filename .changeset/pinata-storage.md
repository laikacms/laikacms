---
"@laikacms/pinata": minor
---

New package: `@laikacms/pinata`. First export `@laikacms/pinata/storage-ipfs` — a
`StorageRepository` backed by IPFS via Pinata. **The first content-addressed backend** in the suite
— every other storage backend is path-addressed, id-addressed, or filter-indexed. IPFS hashes
content into a CID, so updates are inherently copy-on-write: pin new content (new CID) → unpin old.
The mutable storage contract sits on top of Pinata's pin-metadata search (`metadata[name]` and
`metadata[keyvalues]` operator filters). Runtime-agnostic — only depends on `fetch`.
