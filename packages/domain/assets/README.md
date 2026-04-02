# @laikacms/assets

[![npm](https://img.shields.io/npm/v/@laikacms/assets)](https://www.npmjs.com/package/@laikacms/assets)
[![npm](https://img.shields.io/npm/dm/@laikacms/assets)](https://www.npmjs.com/package/@laikacms/assets)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/assets)](https://bundlephobia.com/result?p=@laikacms/assets)

Asset/media management for Laika CMS.

## Installation

```bash
pnpm add @laikacms/assets
```

## Usage

```typescript
import { AssetsRepository, Asset, AssetCreate } from '@laikacms/assets'
```

## Entities

- `Asset` - Binary file with metadata
- `AssetMetadata` - File metadata (size, mime type, etc.)
- `AssetUrl` - Signed URL for asset access

## Repository Interface

```typescript
abstract class AssetsRepository {
  abstract getAsset(key: string): ResultStream<Asset>
  abstract createAsset(create: AssetCreate): ResultStream<Asset>
  abstract getUrls(assets: Asset[]): ResultStream<AssetUrl[]>
  // ...
}
```

## Implementations

- `@laikacms/assets-r2` - Cloudflare R2
