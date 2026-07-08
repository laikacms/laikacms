---
"laikacms": minor
---

Add OpenAPI 3.1 specifications to all four API packages (assets-api, contentbase-api, documents-api,
storage-api). Each package now exports a `build*OpenApi({ basePath })` builder returning a typed
`OpenApiDocument`, and each server serves its spec at `GET {basePath}/openapi.json`. Shared OpenAPI
authoring types are exported from `laikacms/json-api`.
