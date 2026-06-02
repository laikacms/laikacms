# @laikacms/contentful

## 1.0.1

### Patch Changes

- Updated dependencies [e488528]
  - laikacms@1.0.1

## 1.0.0

### Minor Changes

- Initial release. Contentful-backed `StorageRepository` via the Content Management API. Content
  types map to folders, entries to objects, with the entry's `fields` flattened to the configured
  `defaultLocale`. Native optimistic concurrency via `sys.version` exposed as `metadata.revisionId`.
  `createFolder` idempotently creates and activates a content type with a default `body: Text`
  schema. Runtime-agnostic — only depends on `fetch`.
