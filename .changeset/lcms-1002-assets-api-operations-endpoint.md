---
"laikacms": minor
---

`assets-api` gains `POST /operations`, a fail-fast batch-write endpoint mirroring `documents-api`'s
post-ADR-004 semantics (pre-flight validates the whole batch, `400` with zero writes on any bad op,
stops on first error during application). `AssetsJsonApiProxyRepository` now batches multi-op writes
through this endpoint the way the storage and documents proxies do (LCMS-1002).
