---
"@laikacms/azure": minor
---

New package: `@laikacms/azure`. First export `@laikacms/azure/storage-blob` —
a `StorageRepository` backed by Azure Blob Storage. Mirrors the
`@laikacms/aws/storage-s3` shape (flat container, simulated `/`-delimited
folders, `.keep` placeholders, ETag exposed as `metadata.revisionId`) but
speaks the Azure SDK via a tiny `BlobOps` adapter — so tests can construct a
plain object literal as the datasource without mocking SDK internals.
`@azure/storage-blob` is an optional peer.

Completes the AWS / GCP / Azure cloud-storage trio in the suite alongside
`@laikacms/aws/storage-s3` and `@laikacms/google/storage-drive`.
