---
"laikacms": minor
---

Add `laikacms/storage/web-fs` — a `WebFsStorageRepository` implementing the `StorageRepository`
contract against the browser's File System API: any `FileSystemDirectoryHandle`, whether the
origin-private file system root (the default), a user-picked `showDirectoryPicker()` directory, or
an injected shim. Real directory hierarchy (empty folders without `.keep` markers), raw file
contents, namespace subdirectory isolation, lazy SSR-safe resolution of
`navigator.storage.getDirectory()`, and typed error mapping for quota, traversal, and
non-empty-folder deletion.

Every operation re-validates the root handle before touching it — `queryPermission({ mode })` when
the handle exposes it, plus a liveness probe — and fails with one of three new typed errors in
`laikacms/core` that tell the application how to recover: `PermissionPromptRequiredError`
(`permission_prompt_required`, 403 — re-request in a user gesture, retry), `PermissionDeniedError`
(`permission_denied`, 403 — grant anew), or `StaleHandleError` (`stale_handle`, 410 — the directory
is gone or the persisted handle expired, pick again). The repository never calls
`requestPermission()` itself and does not care where a handle came from.
