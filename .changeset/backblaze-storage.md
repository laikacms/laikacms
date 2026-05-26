---
"@laikacms/backblaze": minor
---

New package: `@laikacms/backblaze`. First export `@laikacms/backblaze/storage-b2` — a
`StorageRepository` backed by Backblaze B2 via the **native API** (not the S3-compatible mode; the
S3 mode is already covered by `@laikacms/aws/storage-s3`). Five wire-format traits distinguish it
from every prior backend: (1) **two-phase upload pattern** — every upload requires a separate
`b2_get_upload_url` call first, which returns a fresh `uploadUrl` + `uploadAuthorizationToken` pair;
the subsequent `b2_upload_file` POSTs to _that_ URL with _that_ token, on a different endpoint and
different lifecycle. **First backend with this auth pattern**; (2) **file versioning by default** —
every upload creates a new version; deletes need the `(fileName, fileId)` tuple, not just the name.
Distinct from S3-style overwrite-in-place; (3) **mandatory SHA-1 content verification** — uploads
MUST include `X-Bz-Content-Sha1` header matching the actual content; B2 rejects mismatches at the
storage layer. **First backend in the suite with mandatory content-hash verification on writes**.
The data source computes SHA-1 via Web Crypto (`computeSha1Hex` helper exported); (4) **bare
`Authorization: <token>` header** (no `Bearer`, no `Token`, no `Basic`). Distinct from every other
auth header convention; (5) **POST-for-everything API** — even reads of metadata use POST with a
JSON body. First backend with this convention. Account auth and upload URLs are cached automatically
(~23h lifetime); re-acquisition on 503. `removeAtoms(N)` does N parallel `b2_delete_file_version`
calls — B2 has no bulk-delete endpoint; not a new atomic-multi-write mechanism. Runtime-agnostic —
only depends on `fetch` and Web Crypto.
