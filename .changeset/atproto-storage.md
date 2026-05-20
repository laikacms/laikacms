---
"@laikacms/atproto": minor
---

New package: `@laikacms/atproto`. First export
`@laikacms/atproto/storage-atproto` — a `StorageRepository` backed by
an AT Protocol repo on a PDS (Personal Data Server). Works against
Bluesky's hosted PDS, self-hosted `pds`, and any AT
Protocol-compatible host. Three architectural traits distinguish it
from the rest of the suite: (1) **DID-based repo identity** — the
repo *is* a DID like `did:plc:abc...`, no separate "database name";
(2) **content-addressable records** — every record carries a CID
(SHA-256-based hash of the canonicalised CBOR encoding) that surfaces
as `metadata.revisionId`. **First content-addressable backend in the
suite**; (3) **`applyWrites` with discriminated-union actions** —
the atomic multi-record write primitive takes an array tagged with
`$type: 'com.atproto.repo.applyWrites#{create|update|delete}'`.
`removeAtoms(N)` ships as one `applyWrites` call with N `#delete`
actions — the 11th structurally distinct atomic-multi-write
mechanism. Plus: rkey range scans via `[rkeyStart, rkeyEnd)` for
prefix listing, and `swapRecord` CAS on updates using the prior CID.
Runtime-agnostic — only depends on `fetch`.
