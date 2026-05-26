---
"@laikacms/aws": minor
---

New subpath export `@laikacms/aws/storage-s3` — an S3-backed `StorageRepository`. Mirrors
`laikacms/storage-r2` but talks the AWS SDK v3 (`@aws-sdk/client-s3`) instead of the Cloudflare R2
binding. Works against AWS S3, MinIO, LocalStack, Backblaze B2, Wasabi, DigitalOcean Spaces, and any
other S3-API-compatible store. `@aws-sdk/client-s3` is an **optional peer**; add it alongside
`@laikacms/aws` only if you intend to use this subpath.
