---
"@laikacms/aws": minor
---

New subpath export `@laikacms/aws/assets-s3` — an S3-backed
`AssetsRepository`. This is the **second contract** layered on the same
`S3Client` already used by `@laikacms/aws/storage-s3`: identical bucket
model, identical key model, different Laika contract. Pair them on one
bucket (separated by `basePath`) for combined content storage + asset
hosting from a single AWS resource.

Variations are pure URL transforms — S3 doesn't process images, so each
`S3AssetVariationSpec` owns the function that turns the asset's key into a
CDN URL (CloudFront + Lambda@Edge / Cloudflare Image Resizing / Imgix / a
custom worker). `getVariations` runs zero round-trips. Optional
`allowedMimeTypes` allow-list rejects unsupported uploads upfront.
`getMetadata` upgrades to `ImageMetadata` when `customMetadata` includes
`width` / `height` hints at upload time, otherwise returns `BinaryMetadata`.

Demonstrates that one backend can satisfy two Laika contracts simultaneously.
