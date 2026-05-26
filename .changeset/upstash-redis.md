---
"@laikacms/upstash": minor
---

New package: `@laikacms/upstash`. First export `@laikacms/upstash/storage-redis` — a
`StorageRepository` backed by Redis via the Upstash REST API. Edge-friendly (only depends on
`fetch`); pipelined `EXISTS` probe resolves an extension-free key in a single round-trip regardless
of how many serializers are registered; explicit folder markers so empty folders are first-class.
Useful as a cache-tier in front of S3/DDB-backed storage, or as a standalone storage for edge-only
deployments.
