import type { Folder, FolderCreate, Key } from 'laikacms/storage';

import type { LaikaDone, LaikaStream, LaikaTask, Pagination } from 'laikacms/core';
import type {
  Asset,
  AssetCreate,
  AssetMetadata,
  AssetsCapabilities,
  AssetUpdate,
  AssetUrl,
  AssetVariations,
  Resource,
} from '../entities/index.js';

/**
 * Hints for prefetching related data.
 */
export interface FetchHints {
  variations?: boolean;
  urls?: boolean;
  metadata?: boolean;
}

export interface GetResourceOptions {
  hints?: FetchHints;
}

export interface ListResourcesOptions {
  pagination: Pagination;
  depth: number;
  hints?: FetchHints;
}

export type ListResourcesDone = LaikaDone;

export interface DeleteAssetsDone extends LaikaDone {
  readonly removed: number;
  readonly skipped: number;
}

/**
 * Abstract repository for managing binary assets (images, files, media).
 *
 * Single-result operations return LaikaTask; multi-item operations return
 * LaikaStream with typed Done values. Recoverable errors (per-item failures
 * during bulk operations) surface via the stream's metadata channel.
 */
export abstract class AssetsRepository {
  abstract getCapabilities(): LaikaTask.LaikaTask<AssetsCapabilities>;

  // Resource Operations (unified endpoint)

  /**
   * Get a resource (asset or folder) by key.
   * Returns an array because a single key may resolve to multiple resources
   * (e.g. variations included via hints).
   */
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

  /**
   * Delete multiple assets. Emits each successfully-removed key as data;
   * per-key failures surface as recoverable errors.
   */
  abstract deleteAssets(keys: readonly Key[]): LaikaStream.LaikaStream<Key, DeleteAssetsDone>;

  /**
   * Compute variation URLs for the given assets, one entry per asset.
   * Per-asset failures (e.g. unsupported format) surface as recoverable errors.
   */
  abstract getVariations(
    assets: Asset[],
  ): LaikaStream.LaikaStream<AssetVariations, LaikaDone>;

  abstract getUrls(assets: Asset[]): LaikaStream.LaikaStream<AssetUrl, LaikaDone>;

  abstract getMetadata(assets: Asset[]): LaikaStream.LaikaStream<AssetMetadata, LaikaDone>;

  // Folder Operations

  abstract getFolder(key: Key): LaikaTask.LaikaTask<Folder>;
  abstract createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder>;
  abstract deleteFolder(key: string, recursive?: boolean): LaikaTask.LaikaTask<void>;
}
