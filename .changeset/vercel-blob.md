---
"@laikacms/vercel": minor
---

New package: `@laikacms/vercel`. First export `@laikacms/vercel/storage-blob` — a
`StorageRepository` backed by [Vercel Blob](https://vercel.com/docs/storage/vercel-blob). Two
architectural quirks distinguish it from the S3/R2 line: (1) deletes go through `POST /delete` with
URLs in the body, not `DELETE /<key>`, so `removeAtoms(N)` packs into **one** round-trip; (2)
Vercel's list endpoint has no `delimiter` param, so subfolder grouping is reconstructed client-side.
`addRandomSuffix=0` is hard-coded on every upload so key→URL is deterministic. Runtime-agnostic —
only depends on `fetch`.
