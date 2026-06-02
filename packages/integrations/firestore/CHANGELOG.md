# @laikacms/firestore

## 1.0.1

### Patch Changes

- Updated dependencies [e488528]
  - laikacms@1.0.1

## 1.0.0

### Minor Changes

- Initial release. Firestore-backed `StorageRepository` via the REST API. Walks Laika's
  `/`-separated keys onto Firestore's alternating collection/document scheme: every path segment
  becomes a document, every folder owns an `items` subcollection. Listing a folder is one native
  subcollection `GET`. Path segments restricted to `^[A-Za-z0-9._-]+$`. Runtime-agnostic — only
  depends on `fetch`.
