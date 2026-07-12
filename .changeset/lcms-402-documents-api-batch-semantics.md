---
"laikacms": minor
---

**`documents-api` POST `/operations` — fail-fast batch semantics (ADR-004, LCMS-402)**

The `/operations` endpoint has been updated to drop the JSON:API Atomic Operations vocabulary and
implement honest fail-fast batch semantics:

- **Request key renamed**: `atomic:operations` → `operations`
- **Response key renamed**: `atomic:results` → `results`
- **Pre-flight validation**: all operations are shape-validated before any I/O; a batch with any
  malformed op (e.g. `add` missing `data.id`) returns HTTP 400 with zero writes
- **Sequential application**: operations are now applied in order rather than concurrently; the
  first repository failure stops processing — no subsequent ops run
- **Explicit semantics**: a mid-batch repository failure leaves previously-applied ops applied; this
  endpoint is a fail-fast batch, not a transaction

The wire surface changed, but there are no known in-repo or external consumers of the old
`atomic:operations` / `atomic:results` vocabulary (the Decap backend does not call `/operations`).
