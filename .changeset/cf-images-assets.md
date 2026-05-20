---
"@laikacms/cloudflare": minor
---

New subpath export `@laikacms/cloudflare/assets-cf-images` — an
`AssetsRepository` backed by Cloudflare Images. Sits alongside the existing
`storage-d1` in the same package — second dual-contract package in the
suite (after `@laikacms/aws`).

The interesting difference from `@laikacms/cloudinary/assets-cloudinary`:
Cloudflare Images defines variants **at the account level**, not per URL.
Cloudinary variations are arbitrary URL transforms; Cloudflare Images
variants are named entries you configure in the dashboard (`public`,
`thumbnail`, …) and the repository emits one delivery URL per name via
`https://imagedelivery.net/<accountHash>/<imageId>/<variant>`. `accountHash`
is distinct from `accountId`. Custom `deliveryUrl` override available for
Worker-fronted custom delivery domains.
