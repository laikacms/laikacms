---
"@laikacms/cloudinary": minor
---

New package: `@laikacms/cloudinary`. First export `@laikacms/cloudinary/assets-cloudinary` — a
Cloudinary-backed `AssetsRepository`. This is the **first non-storage** integration in the suite:
every previous backend implemented `StorageRepository`; this one implements the assets contract
(images, variations, URLs, metadata).

Signs uploads with SHA-1 via Web Crypto so the API secret never crosses the wire; deterministic URL
transforms make `getVariations` zero-cost (no API call per variant). Default six variations
(thumbnail/small/medium/large/webp/avif) or a caller-supplied set. Runtime- agnostic — only depends
on `fetch` and `crypto.subtle`.
