import type { ChangeSummary, Folder, FolderCreate, Key, SyncToken } from 'laikacms/storage';

import type { LaikaDone, Pagination } from 'laikacms/core';
import { LaikaStream, LaikaTask, NotImplementedError } from 'laikacms/core';
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

export interface GetSyncTokenOptions {
  /** Scope the token to a folder; omit for the whole store. */
  folder?: string;
}

export interface ListChangesOptions {
  /** A token previously obtained from `getSyncToken` or `listChanges`. */
  since: SyncToken;
  /** Scope the feed to a folder; omit for the whole store. */
  folder?: string;
}

/**
 * Done value returned by `listChanges`. Carries the sync token that captures
 * the state of the scope after the listed changes; pass it as `since` on the
 * next call to resume the feed.
 */
export interface ListChangesDone extends LaikaDone {
  readonly syncToken: SyncToken;
}

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

  // Change signals (capability-gated; see AssetsCapabilities.changes)

  /**
   * Return an opaque token for the given scope (a folder, or the whole store
   * when omitted) that changes whenever anything inside the scope changes.
   * Compare tokens only by equality.
   *
   * Non-abstract on purpose: existing subclasses stay source-compatible. The
   * base implementation fails with `NotImplementedError`; check
   * `getCapabilities().changes` before calling.
   */
  getSyncToken(options?: GetSyncTokenOptions): LaikaTask.LaikaTask<SyncToken> {
    void options;
    return LaikaTask.fail(
      new NotImplementedError(
        'getSyncToken is not supported by this assets repository. '
          + 'Consult getCapabilities().changes before calling.',
      ),
    );
  }

  /**
   * Enumerate what changed inside the scope since a previously obtained sync
   * token. The done value carries the new sync token to resume from.
   *
   * Non-abstract on purpose: existing subclasses stay source-compatible. The
   * base implementation fails with `NotImplementedError`; check
   * `getCapabilities().changes` before calling.
   */
  listChanges(options: ListChangesOptions): LaikaStream.LaikaStream<ChangeSummary, ListChangesDone> {
    void options;
    return LaikaStream.fail(
      new NotImplementedError(
        'listChanges is not supported by this assets repository. '
          + 'Consult getCapabilities().changes before calling.',
      ),
    );
  }
}
