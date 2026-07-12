---
"laikacms": major
---

**BREAKING: `documents-api` POST `/operations` — fail-fast batch semantics (ADR-004, LCMS-402)**

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

**Why `major`:** this is a wire-breaking change to a public export (`laikacms/documents/api`) of a
published package. There are no in-repo consumers of the old vocabulary — the Decap backend does not
call `/operations`, and `storage-jsonapi-proxy` targets the _storage-api_ `/operations` endpoint,
whose `atomic:*` vocabulary is deliberately unchanged. But downstream users who stand up the
documents-api server have their own HTTP clients, and those clients break. A `minor` bump would let
them auto-upgrade on `^1.x` into a silent 400. Semver is the only contract we have with them.

**Migration:** rename the request key `atomic:operations` → `operations` and read results from
`results` instead of `atomic:results`. Batches that previously returned `200` with a mix of
successes and per-op errors now return `400` with zero writes if any op is shape-invalid, and stop
at the first repository failure otherwise.

Note: the **storage-api** `/operations` endpoint is untouched and still speaks `atomic:operations` /
`atomic:results`. Only the documents-api endpoint changes.
