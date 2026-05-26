---
"laikacms": minor
---

Add `laikacms/storage-webdav`: a runtime-agnostic `StorageRepository` implementation backed by any
RFC 4918 WebDAV server (Nextcloud, ownCloud, Apache `mod_dav`, `rclone serve webdav`, ...).
Authenticates with HTTP Basic or Bearer tokens, automatically creates parent collections via
`MKCOL`, and refuses to delete non-empty folders. Only depends on a `fetch` implementation, so it
runs on Node, Bun, Deno, Cloudflare Workers, and the browser.
