# laikacms/assets

[![npm](https://img.shields.io/npm/v/laikacms)](https://www.npmjs.com/package/laikacms)
[![npm](https://img.shields.io/npm/dm/laikacms)](https://www.npmjs.com/package/laikacms)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/laikacms)](https://bundlephobia.com/result?p=laikacms)

Asset/media management for Laika CMS.

## Installation

```bash
pnpm add laikacms
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

  // Change signals (capability-gated; check getCapabilities().changes before calling)
  getSyncToken(options?: GetSyncTokenOptions): LaikaTask.LaikaTask<SyncToken>;
  listChanges(options: ListChangesOptions): LaikaStream.LaikaStream<ChangeSummary, ListChangesDone>;
}
```

## Capabilities

`getCapabilities()` returns an `AssetsCapabilities` object with five fields:

| Field               | Description                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compatibilityDate` | Opaque version string — implementations increment this when they change behavior in a breaking way.                                                                                                                      |
| `pagination`        | Which pagination styles (`offset`, `page`, `cursor`) the repository honors on `listResources`. `supported: false` means pagination is ignored and full lists are always returned.                                        |
| `versionTracking`   | Whether the repository attaches an opaque per-record `version` token to returned assets. Tokens change only when content changes; compare by equality.                                                                   |
| `changes`           | Whether `getSyncToken` and `listChanges` are implemented. `syncToken: true` means `getSyncToken` works; `changeFeed: true` means `listChanges` works. Both default to `false` (methods fail with `NotImplementedError`). |
| `filtering`         | _(optional)_ Named filters honored by `listResources` (e.g. `search`). Absent means no filters are supported; implementations fail with `InvalidData` on undeclared filter names rather than silently ignoring them.     |

## Implementations

- `laikacms/assets/r2` - Cloudflare R2
- `laikacms/assets/obsidian` - Obsidian vault files (read-oriented)
- `laikacms/assets/contentbase` - Assets on top of a ContentBase storage backend
- `laikacms/assets/jsonapi-proxy` - Assets JSON:API proxy
