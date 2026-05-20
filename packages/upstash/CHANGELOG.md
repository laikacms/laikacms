# @laikacms/upstash

## 1.0.0

### Minor Changes

- Initial release. Redis-backed `StorageRepository` via the Upstash REST
  API. Edge-friendly (only depends on `fetch`); pipelined extension probe
  resolves a key in a single round-trip regardless of how many serializers
  are registered; explicit folder markers so empty folders surface in
  listings.
