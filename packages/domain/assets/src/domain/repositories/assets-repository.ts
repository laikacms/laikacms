import { Folder, FolderCreate, Key, Pagination } from '@laikacms/storage';

import { LaikaError, LaikaResult } from '@laikacms/core';
import type {
  Asset,
  AssetCreate,
  AssetMetadata,
  AssetUpdate,
  AssetUrl,
  AssetVariations,
  Resource,
} from '../entities/index.js';

/**
 * Hints for prefetching related data.
 *
 * On the domain level, these are called "hints" to indicate they are
 * suggestions for what data to prefetch. The API layer (JSON:API) may
 * expose these as `?include=asset-metadata,asset-url,asset-variation`.
 */
export interface FetchHints {
  /**
   * Prefetch variation URLs.
   * Maps to getVariations() method.
   */
  variations?: boolean;

  /**
   * Prefetch access URLs.
   * Maps to getUrls() method.
   */
  urls?: boolean;

  /**
   * Prefetch full metadata.
   * Maps to getMetadata() method.
   */
  metadata?: boolean;
}

/**
 * Options for getting a single resource.
 */
export interface GetResourceOptions {
  /**
   * Hints for prefetching related data.
   */
  hints?: FetchHints;
}

/**
 * Options for listing resources.
 */
export interface ListResourcesOptions {
  pagination: Pagination;

  depth: number;

  /**
   * Hints for prefetching related data.
   */
  hints?: FetchHints;
}

type ResultStream<T> = AsyncGenerator<LaikaResult<T>>;

/**
 * Abstract repository for managing binary assets (images, files, media).
 *
 * This abstraction provides a unified `/resources` endpoint pattern where:
 * - Resources are either Assets (files) or Folders
 * - Related data (metadata, variations, URLs) can be included via `?include=`
 *
 * Key design decisions:
 *
 * 1. **Asset extends StorageObject pattern**: Asset adds a type discriminator.
 *    The content field is inherited from StorageObject.
 *
 * 2. **Decoupled related data**: Variations, URLs, and metadata are fetched via
 *    dedicated methods that can be called independently or included via
 *    the `include` option on get/list operations.
 *
 * 3. **JSON:API includes**: Use `?include=asset-metadata,asset-url,asset-variation`
 *    to request related data in a single request.
 *
 * 4. **Discriminated metadata**: Asset metadata uses a discriminated union based
 *    on 'kind' (image, video, audio, document, binary) for type-safe access.
 *
 * 5. **Simple createAsset**: Multipart uploads and chunking are implementation
 *    details handled internally.
 *
 * 6. **Resource union type**: Resource is Asset | Folder.
 */
export abstract class AssetsRepository {
  // ============================================
  // Resource Operations (unified endpoint)
  // ============================================

  /**
   * Get a resource (asset or folder) by key.
   *
   * Use `hints` option to request related data to be prefetched:
   * - `hints.metadata` - Prefetch asset metadata
   * - `hints.urls` - Prefetch access URLs
   * - `hints.variations` - Prefetch variation URLs
   *
   * @param key The resource key
   * @param options Options including hints for prefetching
   */
  abstract getResource(key: string, options?: GetResourceOptions): ResultStream<Resource[]>;

  /**
   * List all resources (assets and folders) in a folder.
   *
   * Use `hints` option to request related data to be prefetched for all assets:
   * - `hints.metadata` - Prefetch asset metadata
   * - `hints.urls` - Prefetch access URLs
   * - `hints.variations` - Prefetch variation URLs
   *
   * @param folderKey The folder to list
   * @param options Pagination and hints for prefetching
   */
  abstract listResources(
    folderKey: string,
    options: ListResourcesOptions,
  ): ResultStream<Resource[]>;

  // ============================================
  // Asset Operations
  // ============================================

  /**
   * Get a single asset by key.
   *
   * @param key The asset key
   * @param options Options including hints for prefetching
   */
  abstract getAsset(key: string, options?: GetResourceOptions): ResultStream<Asset>;

  /**
   * Create a new asset.
   *
   * The implementation handles all upload complexity internally:
   * - Small files may be uploaded in a single request
   * - Large files may use multipart uploads (S3, R2)
   * - Streaming uploads may use resumable protocols (Google Drive)
   */
  abstract createAsset(create: AssetCreate): ResultStream<Asset>;

  /**
   * Update an asset's metadata.
   */
  abstract updateAsset(update: AssetUpdate): ResultStream<Asset>;

  /**
   * Delete an asset.
   */
  abstract deleteAsset(key: Key): ResultStream<void>;

  /**
   * Delete multiple assets.
   * Yields results in batches for progress tracking.
   */
  abstract deleteAssets(keys: readonly Key[]): ResultStream<Key[]>;

  abstract getVariations(assets: Asset[]): ResultStream<AssetVariations[]>;

  abstract getUrls(assets: Asset[]): ResultStream<AssetUrl[]>;

  abstract getMetadata(assets: Asset[]): ResultStream<AssetMetadata[]>;

  // ============================================
  // Folder Operations
  // ============================================

  /**
   * Get folder metadata.
   */
  abstract getFolder(key: Key): ResultStream<Folder>;

  /**
   * Create a new folder.
   */
  abstract createFolder(folderCreate: FolderCreate): ResultStream<Folder>;

  /**
   * Delete a folder.
   * @param recursive If true, delete all contents. If false, fail if not empty.
   */
  abstract deleteFolder(key: string, recursive?: boolean): ResultStream<void>;
}
