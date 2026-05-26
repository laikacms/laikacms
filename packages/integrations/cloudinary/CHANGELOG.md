# @laikacms/cloudinary

## 1.0.0

### Minor Changes

- Initial release. First export `@laikacms/cloudinary/assets-cloudinary` — a Cloudinary-backed
  `AssetsRepository`. Signed uploads (SHA-1 via Web Crypto, secret stays on the server), Admin API
  for metadata + folder operations, deterministic URL transforms for variations. Six default
  variations (thumbnail/small/medium/large/webp/avif) or a caller-supplied set. Runtime-agnostic —
  only depends on `fetch` and `crypto.subtle`.
