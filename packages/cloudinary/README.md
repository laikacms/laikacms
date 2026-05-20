# `@laikacms/cloudinary`

Cloudinary-backed `AssetsRepository` for Laika CMS. The **first non-storage** integration in the workspace — every previous backend implemented `StorageRepository`; this one implements the assets contract (images, variations, URLs, metadata).

Runtime-agnostic — only depends on `fetch` and Web Crypto (`crypto.subtle.digest('SHA-1', …)`). Works on Node 22+, Bun, Deno, Cloudflare Workers, modern browsers.

## `@laikacms/cloudinary/assets-cloudinary`

```ts
import { CloudinaryAssetsRepository } from '@laikacms/cloudinary/assets-cloudinary';

const repo = new CloudinaryAssetsRepository({
  auth: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
    apiKey:    process.env.CLOUDINARY_API_KEY!,
    apiSecret: process.env.CLOUDINARY_API_SECRET!,
  },
  // Optional — override the default six transforms (thumbnail/small/medium/large/webp/avif):
  // variations: [{ name: 'og', transform: 'c_fill,w_1200,h_630', width: 1200, height: 630 }],
});
```

### Why Cloudinary fits `AssetsRepository`

Cloudinary's data model lines up almost exactly with the Laika assets shape:

| Laika concept | Cloudinary equivalent |
|---|---|
| Asset key | `public_id` (path-like, with real folders) |
| Asset content | binary upload via Upload API |
| `getUrls(asset)` | deterministic `…/v{version}/{publicId}.{format}` URL |
| `getVariations(asset)` | deterministic URLs with [transformations](https://cloudinary.com/documentation/transformation_reference) (`c_fill,w_400,…`) inserted into the path |
| `getMetadata(asset)` | Admin `resources/info` → `ImageMetadata` |
| `Folder` | real Cloudinary folder (Admin folders API) |

The killer feature: **variations cost nothing**. They're computed locally as URL strings, not fetched. The default six transforms (`thumbnail`, `small`, `medium`, `large`, `webp`, `avif`) are derived deterministically from the asset's `version`, `publicId`, and `format`; pass `variations` to the constructor to override the set.

### Auth split

Cloudinary uses two auth modes — the repository handles both behind the scenes:

- **Upload API** → signed params. The repository constructs `signature = SHA1(sorted_kv_pairs + api_secret)` via Web Crypto and includes it in the URL-encoded form body. **The `api_secret` never crosses the wire.**
- **Admin API** → HTTP Basic with `api_key:api_secret`. Used for `getAsset`, `listResources`, bulk delete, folder operations.

The `signParams` helper is exported so you can verify or recompute signatures in your own code.

### Behaviour notes

- **Path-shaped public ids.** `createAsset({key: 'photos/hero', …})` uploads with `public_id=photos/hero`. Cloudinary auto-creates the `photos` folder. `listResources('photos')` then surfaces it.
- **Direct-children listing.** Cloudinary's prefix match is recursive; the repository filters to direct children so nested assets don't leak in. Subfolders come from a parallel `GET /folders/{path}` call.
- **Permanent deletes.** `deleteAsset` / `deleteAssets` call `DELETE /resources/image/upload` (no trash).
- **Update is metadata-only.** `updateAsset` confirms the asset exists and returns its current state. To replace the binary content, call `createAsset` again with `overwrite=true` (or extend the repository — the underlying `dataSource.upload` exposes `overwrite`).
- **Variations never API-call.** `getVariations` emits one record per asset by composing URLs locally. Bandwidth and latency stay flat regardless of how many variants are in your spec.

### Errors

| HTTP | Laika error |
|---|---|
| 400 (`"already exists"`) | `EntryAlreadyExistsError` |
| 400 (other) | `InternalError` (with the upstream message) |
| 401 | `AuthenticationError` |
| 403 | `ForbiddenError` |
| 404 | `NotFoundError` |
| 420 / 429 | `TooManyRequestsError` |
| 5xx | `ServiceUnavailableError` |

### What this does not do

- No video transformations / streaming presets (the package is `image`-focused by default — pass `resourceType: 'video'` to target the video pipeline).
- No upload presets (unsigned uploads). Signed uploads cover the safe authoring case; presets are a UX concern best handled in the caller.
- No transformations expressed via the [Eager](https://cloudinary.com/documentation/upload_images#eager_transformations) API. Variations are derivative URLs, not pre-generated derivative resources.
