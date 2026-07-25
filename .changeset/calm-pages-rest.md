---
"laikacms": patch
---

Clamp client-requested JSON:API page sizes to 100 for cursor, page-number, and offset pagination.
This bounds the number of records buffered at API boundaries while preserving existing pagination
semantics by reducing oversized requests instead of rejecting them.

Package documentation now also:

- warns that `buildJsonApi` does not provide authentication;
- documents document and asset change-signal capabilities;
- corrects pagination and storage API endpoint examples; and
- expands the documented asset filter capabilities.

The published package now includes an MIT `LICENSE` file.
