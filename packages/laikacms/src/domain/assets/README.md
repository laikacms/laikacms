# laikacms/assets

[![npm](https://img.shields.io/npm/v/laikacms/assets)](https://www.npmjs.com/package/laikacms/assets)
[![npm](https://img.shields.io/npm/dm/laikacms/assets)](https://www.npmjs.com/package/laikacms/assets)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/laikacms/assets)](https://bundlephobia.com/result?p=laikacms/assets)

Asset/media management for Laika CMS.

## Installation

```bash
pnpm add laikacms/assets
```

## Usage

```typescript
import { Asset, AssetCreate, AssetsRepository } from 'laikacms/assets';
```

## Entities

- `Asset` - Binary file with metadata
- `AssetMetadata` - File metadata (size, mime type, etc.)
- `AssetUrl` - Signed URL for asset access

## Repository Interface

```typescript
abstract class AssetsRepository {
  abstract getCapabilities(): LaikaTask.LaikaTask<AssetsCapabilities>;

  // Resource Operations
  abstract getResource(
    key: string,
    options?: GetResourceOptions,
  ): LaikaTask.LaikaTask<ReadonlyArray<Resource>>;
  abstract listResources(
    folderKey: string,
    options: ListResourcesOptions,
  ): LaikaStream.LaikaStream<Resource, ListResourcesDone>;

  // Asset Operations
  abstract getAsset(key: string, options?: GetResourceOptions): LaikaTask.LaikaTask<Asset>;
  abstract createAsset(create: AssetCreate): LaikaTask.LaikaTask<Asset>;
  abstract updateAsset(update: AssetUpdate): LaikaTask.LaikaTask<Asset>;
  abstract deleteAsset(key: Key): LaikaTask.LaikaTask<void>;
  abstract deleteAssets(keys: readonly Key[]): LaikaStream.LaikaStream<Key, DeleteAssetsDone>;
  abstract getVariations(assets: Asset[]): LaikaStream.LaikaStream<AssetVariations, LaikaDone>;
  abstract getUrls(assets: Asset[]): LaikaStream.LaikaStream<AssetUrl, LaikaDone>;
  abstract getMetadata(assets: Asset[]): LaikaStream.LaikaStream<AssetMetadata, LaikaDone>;

  // Folder Operations
  abstract getFolder(key: Key): LaikaTask.LaikaTask<Folder>;
  abstract createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder>;
  abstract deleteFolder(key: string, recursive?: boolean): LaikaTask.LaikaTask<void>;
}
```

## Implementations

- `laikacms/assets/r2` - Cloudflare R2
- `laikacms/assets/obsidian` - Obsidian vault files (read-oriented)
- `laikacms/assets/contentbase` - Assets on top of a ContentBase storage backend
- `laikacms/assets/jsonapi-proxy` - Assets JSON:API proxy
