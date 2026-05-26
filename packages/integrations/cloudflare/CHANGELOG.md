# @laikacms/cloudflare

## 1.0.0

### Minor Changes

- Initial release. First export `@laikacms/cloudflare/storage-d1` — a `StorageRepository` backed by
  Cloudflare D1 (managed SQLite) over its HTTP REST API. SQL at the edge, runs everywhere `fetch`
  runs. Caller provisions the table via the exported `schemaDdl()` helper. Single- `LIKE` extension
  probe resolves extension-free keys in one round-trip regardless of how many serializers are
  registered.
