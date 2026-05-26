# @laikacms/algolia

## 1.0.0

### Minor Changes

- Initial release. Algolia-backed `StorageRepository` via the REST API. Treats an Algolia index as a
  hierarchical store with virtual folders expressed by a `_parent` attribute, so listing a folder is
  one filtered query rather than a prefix scan. Useful when you want full-text search over content
  "for free" — every record you write with this repository is immediately indexed by Algolia.
