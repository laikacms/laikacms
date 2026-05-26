# @laikacms/gist

## 1.0.0

### Minor Changes

- Initial release. GitHub Gist-backed `StorageRepository`. Every storage operation routes through
  GitHub's single `PATCH /gists/{id}` endpoint with the full file delta in one request —
  `removeAtoms(['a','b','c'])` becomes one PATCH, not three. Slashes in keys encode as `__` because
  GitHub forbids `/` in gist filenames. Runtime-agnostic — only depends on `fetch`.
