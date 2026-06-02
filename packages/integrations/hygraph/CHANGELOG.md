# @laikacms/hygraph

## 1.0.1

### Patch Changes

- Updated dependencies [e488528]
  - laikacms@1.0.1

## 1.0.0

### Minor Changes

- Initial release. Hygraph-backed `StorageRepository` via the GraphQL Content API. First
  true-GraphQL transport in the suite (Sanity uses GROQ). Assumes `LaikaObject` + `LaikaFolder`
  content models exist on the project. Lists both files and folders in **one** GraphQL operation.
  Runtime-agnostic — only depends on `fetch`.
