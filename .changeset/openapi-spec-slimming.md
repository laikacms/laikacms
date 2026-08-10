---
"laikacms": minor
---

Shrink the OpenAPI documents served by the four JSON:API handlers and stop shipping them to
deployments that never ask for one.

The specs were four hand-maintained copies of the same JSON:API vocabulary and had drifted apart:
the assets spec required only `status`/`code` on an error object the runtime always fills with four
members, contentbase omitted `code` and `source` entirely, and every spec advertised a `links.last`
no link builder can produce. That vocabulary now lives once in `laikacms/json-api` as
`jsonApiErrorComponents`, `jsonApiLinkComponents`, `capabilityComponents`, `apiInfoComponents` and
`paginationParameters`, so all four surfaces describe the runtime identically.

New in `laikacms/json-api`: `compactOpenApiDocument`, which hoists response bodies and query
parameters that repeat across operations into `components` and replaces each occurrence with a
`$ref`. Operations keep their own wording — OpenAPI 3.1 allows a `description` alongside `$ref` — so
the pass is lossless once dereferenced. Served documents shrink by 3–14% (documents 41.5 KB → 35.9
KB, storage 30.0 KB → 27.0 KB).

The spec builders are now loaded on demand by their handlers instead of statically imported, so a
bundler puts each one in its own chunk (~30 KB for documents) rather than the startup path of every
worker that mounts the API. `buildDocumentsOpenApi`, `buildStorageOpenApi`, `buildAssetsOpenApi` and
`buildContentbaseOpenApi` remain exported and unchanged in signature.

Also corrects the storage spec's `atomic:results`, which documented failed operations as always
omitted: a failed remove keeps its slot as an `errors` entry so callers stay index-aligned with the
keys they requested.

Component schema names changed in the served documents — notably the assets spec's `ErrorObject` is
now `JsonApiErrorObject`, and contentbase's `JsonApiError`/`JsonApiErrorDocument` are now
`JsonApiErrorObject`/`JsonApiError` — so anything generating clients from a pinned copy of a
document should regenerate.
