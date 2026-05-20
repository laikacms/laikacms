# @laikacms/notion

## 1.0.0

### Minor Changes

- Initial release. Notion-backed `StorageRepository`. Page hierarchy maps
  to storage hierarchy: pages with child pages are folders, leaf pages are
  objects, page body (paragraph blocks) is the object content. Instance-
  local path → id cache so repeat lookups don't pay for the walk twice.
  Runtime-agnostic — only depends on `fetch`.
