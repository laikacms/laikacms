# @laikacms/azure

## 1.0.0

### Minor Changes

- Initial release. First export `@laikacms/azure/storage-blob` — a
  `StorageRepository` backed by Azure Blob Storage. Mirrors
  `@laikacms/aws/storage-s3`'s shape (flat container, simulated
  `/`-delimited folders, `.keep` markers) but talks the official Azure
  SDK via a tiny `BlobOps` adapter — so tests can drive the repository
  from a plain object literal without mocking SDK internals.
  `@azure/storage-blob` is an optional peer.
