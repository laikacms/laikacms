---
"laikacms": minor
---

`DocumentsJsonApiProxyRepository` gains `applyOperations()`, which batches multiple document
mutations (create/update-unpublished/delete/publish/unpublish) into a single `POST /operations` call
to the upstream `documents-api` instead of one HTTP request per op. Follows the server's fail-fast
contract (ADR-004, LCMS-402) and re-emits each per-op result's `meta.warnings` as local
`recoverableError`s (LCMS-994).
