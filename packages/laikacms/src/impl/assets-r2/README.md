# laikacms/assets/r2

Cloudflare R2-backed implementation of `AssetsRepository` for Cloudflare Workers.

> **Runtime: Cloudflare Workers only.** This module uses the R2 Workers binding API (`R2Bucket`). It
> cannot run in Node.js or Bun without a compatible R2 emulator. Use `laikacms/assets/obsidian` or a
> filesystem-based repository for local development.

## Installation

```bash
pnpm add laikacms
```

## Usage

```ts
import { R2AssetsRepository } from 'laikacms/assets/r2';
import { FileSanitizerImpl } from 'laikacms/file-sanitizer';

// Recommended: provide a sanitizer to strip privacy-sensitive metadata
const assets = new R2AssetsRepository({
  bucket: env.MY_BUCKET,
  sanitizer: new FileSanitizerImpl(),
  createUrl: key => `https://assets.example.com/${key}`,
});
```

## Constructor options

| Option                     | Type                                              | Required | Description                                                                                                                          |
| -------------------------- | ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `bucket`                   | `R2Bucket`                                        | Yes      | The Cloudflare R2 bucket binding from the Workers environment.                                                                       |
| `sanitizer`                | `Sanitizer`                                       | Yes\*    | A `Sanitizer` instance that strips privacy-sensitive metadata (EXIF, GPS, …) from uploaded files. See [Sanitizer](#sanitizer) below. |
| `createUrl`                | `(key: string) => string`                         | No       | Maps a storage key to a public URL. If omitted, `getUrls` returns the raw key.                                                       |
| `createVariations`         | `(key: string) => Record<string, AssetVariation>` | No       | Returns named variations (thumbnails, WebP versions, etc.) for an asset key. See [Image variations](#image-variations) below.        |
| `dangerouslyAllowAllFiles` | `true`                                            | No       | Bypasses sanitization entirely. **Do not use in production.** See [Escape hatch](#escape-hatch) below.                               |

\* Either `sanitizer` **or** `{ dangerouslyAllowAllFiles: true }` is required. The constructor
throws at runtime if neither is provided.

## Sanitizer

Uploaded files may contain privacy-sensitive metadata (GPS coordinates, device identifiers, author
names, …). `R2AssetsRepository` requires a `Sanitizer` to strip this metadata before writing to R2.

The recommended implementation is `FileSanitizerImpl` from `laikacms/file-sanitizer`:

```ts
import { FileSanitizerImpl } from 'laikacms/file-sanitizer';

const sanitizer = new FileSanitizerImpl();
```

`FileSanitizerImpl` handles JPEG, PNG, GIF, and WebP files. Other file types are scanned for
dangerous content and rejected if any is found. See the
[`laikacms/file-sanitizer` README](../../shared/file-sanitizer/README.md) for details on supported
formats and limitations.

The `Sanitizer` interface itself is exported from `laikacms/sanitizer` — use it when you need to
pass the type explicitly or write your own implementation:

```ts
import type { Sanitizer } from 'laikacms/sanitizer';
```

## Escape hatch

If you need to accept files without any sanitization (e.g., in a tightly controlled internal tool
where you own the upload pipeline end-to-end), pass `{ dangerouslyAllowAllFiles: true }` instead of
a `sanitizer`:

```ts
const assets = new R2AssetsRepository({
  bucket: env.MY_BUCKET,
  dangerouslyAllowAllFiles: true,
});
```

> [!CAUTION] This bypasses all metadata stripping and file-type checks. Uploaded files may contain
> EXIF data, GPS coordinates, embedded scripts, or other sensitive information. Only use this option
> when you have independent controls in place (e.g., internal-only upload endpoint, antivirus
> scanning, audit logging).

## Filtering

`R2AssetsRepository` supports a named `filter[search]` query parameter when listing resources via
the `assets-api`:

```
GET /resources?filter[search]=logo
```

This performs a **case-insensitive substring match on the resource key** — the example above returns
every asset whose key contains `"logo"` (e.g. `brand/logo.png`, `icons/logo-dark.svg`).

Sending an undeclared filter name (anything other than `search`) returns `400 Bad Request`. Inspect
`GET /capabilities` (`attributes.filtering.filters`) to see the current list of supported filter
names at runtime.

## Image variations

`createVariations` lets you expose pre-generated responsive variants (thumbnails, WebP copies, size
tiers) for each asset. The callback receives the asset key and returns a named map of
`AssetVariation` objects; these are served via `GET /resources/:key?include=variations` on the
`assets-api`.

```ts
import { R2AssetsRepository } from 'laikacms/assets/r2';
import { FileSanitizerImpl } from 'laikacms/file-sanitizer';

const assets = new R2AssetsRepository({
  bucket: env.MY_BUCKET,
  sanitizer: new FileSanitizerImpl(),
  createUrl: key => `https://assets.example.com/${key}`,
  createVariations: key => ({
    thumb: {
      variant: 'thumb',
      url: `https://assets.example.com/thumb/${key}`,
      width: 200,
      height: 200,
    },
    webp: {
      variant: 'webp',
      url: `https://assets.example.com/webp/${key.replace(/\.[^.]+$/, '.webp')}`,
      mimeType: 'image/webp',
    },
  }),
});
```

Return `{}` (or omit the option) for assets that have no variations.

## TypeScript

The options type is exported for consumers that need to reference it explicitly:

```ts
import type { R2AssetsRepositoryOptions } from 'laikacms/assets/r2';
```
