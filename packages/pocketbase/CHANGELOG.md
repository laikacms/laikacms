# @laikacms/pocketbase

## 1.0.0

### Minor Changes

- Initial release. PocketBase-backed `StorageRepository`. The first
  self-hostable open-source backend in the suite — single binary, SQLite
  under the hood, REST + JWT on the wire. Records live in a configurable
  collection (default `laika_storage`); the repository expects the
  collection to be provisioned ahead of time. Runtime-agnostic — only
  depends on `fetch`.
