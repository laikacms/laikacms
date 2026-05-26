---
"@laikacms/gist": minor
---

New package: `@laikacms/gist`. First export `@laikacms/gist/storage-gist` — a `StorageRepository`
backed by a single GitHub Gist. Every storage operation goes through GitHub's single
`PATCH /gists/{id}` endpoint with the full file delta in one request — `removeAtoms(['a','b','c'])`
lands as one atomic PATCH, not three sequential calls. Slashes in keys encode as `__` because GitHub
forbids `/` in gist filenames; the `encodeGistFilename` / `decodeGistFilename` helpers are exported.
Runtime-agnostic — only depends on `fetch`.
