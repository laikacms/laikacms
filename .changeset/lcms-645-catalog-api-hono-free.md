---
"laikacms": patch
---

Remove Hono dependency from `laikacms` core — `catalog-api` now uses a plain
`{ fetch(request: Request): Promise<Response> }` handler matching the sibling APIs (`documents-api`,
`assets-api`, `storage-api`). Drops `hono` and `@hono/node-server` from `peerDependencies`.
