# starter-cloudinary-blog

Blog using **FileSystem for markdown content** + **Cloudinary for media uploads**
via `CloudinaryAssetsRepository`.

This starter shows the low-level `decapApi()` wiring pattern — used when
no preset fits because you need a non-default `AssetsRepository`.

## Quick start

```bash
cp .env.example .env   # fill in your Cloudinary credentials
pnpm dev
# http://localhost:3000/admin  ← upload images, write posts
# http://localhost:3000        ← blog
```

## Why `decapApi()` instead of a preset?

`createCustomLaika` (and `createEmbeddedLaika`) always build
`ContentBaseAssetsRepository` — a storage-backed asset store. There is
currently no option to inject a different `AssetsRepository`.

To use `CloudinaryAssetsRepository` instead, call `decapApi()` directly:

```ts
import { decapApi } from '@laikacms/decap-integrations/decap-api';
import { CloudinaryAssetsRepository } from '@laikacms/cloudinary/assets-cloudinary';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';

const storage = new FileSystemStorageRepository({ basePath: './content', ... });
const settings = new DecapContentBaseSettingsProvider({ storage });
const documents = new ContentBaseDocumentsRepository(storage, settings);
const assets = new CloudinaryAssetsRepository({ auth: { cloudName, apiKey, apiSecret } });

const laikaApi = decapApi({
  documents,
  storage,
  assets,
  basePath: '/api/decap',
  authenticateAccessToken: async token => { /* ... */ },
});
```

This wires up the same Decap JSON:API surface as the presets, but with
your chosen assets backend.

## Architecture

```
Hono server
  ├─ GET  /            blog home (reads from local content/)
  ├─ GET  /blog/:slug  blog post (reads from local content/)
  ├─ GET  /admin       Decap CMS shell
  └─ ALL  /api/decap/* decapApi.fetch
                         ├─ document endpoints → FileSystemStorageRepository
                         └─ asset endpoints    → CloudinaryAssetsRepository
```

## How Cloudinary image uploads work

When an editor uploads an image in Decap CMS:

1. `POST /api/decap/assets` → `decapApi` → `CloudinaryAssetsRepository.createAsset()`
2. The repository signs the request with `SHA-1(sorted_params + api_secret)` via Web Crypto.
   The `api_secret` never crosses the wire to the client.
3. Cloudinary stores the image and returns a CDN URL.
4. Decap CMS inserts the Cloudinary URL into the markdown body.

Default transforms available for every image (`getVariations(asset)` returns deterministic
CDN URLs — no extra API call):

| Name | Transform |
|---|---|
| `thumbnail` | `c_fill,w_80,h_80` |
| `small` | `c_limit,w_400` |
| `medium` | `c_limit,w_800` |
| `large` | `c_limit,w_1600` |
| `webp` | `f_webp,q_auto` |
| `avif` | `f_avif,q_auto` |

## Known limitation — `createCustomLaika` doesn't support custom assets

The `storage` option in `createCustomLaika` accepts any `StorageRepository`,
but the assets repository is always hard-wired to `ContentBaseAssetsRepository`.
This starter documents the workaround: call `decapApi()` from
`@laikacms/decap-integrations/decap-api` directly.

If you're reading this and want to improve LaikaCMS: a `customAssets` option
on `createCustomLaika` would eliminate the boilerplate above.
