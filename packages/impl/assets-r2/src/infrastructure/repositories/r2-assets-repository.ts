import type {
  Asset,
  AssetCreate,
  AssetMetadata,
  AssetMetadataContent,
  AssetUpdate,
  AssetUrl,
  AssetVariations,
  GetResourceOptions,
  ListResourcesOptions,
  Resource,
} from '@laikacms/assets';
import { AssetsRepository } from '@laikacms/assets';
import type { LaikaError, LaikaResult } from '@laikacms/core';
import { BadRequestError, InternalError, NotFoundError } from '@laikacms/core';
import type { Sanitizer } from '@laikacms/sanitizer';
import type { Folder, FolderCreate } from '@laikacms/storage';
import * as Result from 'effect/Result';
import { R2AssetsDataSource } from '../datasources/r2-assets-datasource.js';

/**
 * Helper to convert a failure result to a different type while preserving the error
 */
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

/**
 * Base configuration options for R2AssetsRepository (without sanitizer)
 */
interface R2AssetsRepositoryOptions {
  /**
   * The R2 bucket to use for storage
   */
  bucket: R2Bucket;
  sanitizer: Sanitizer | { dangerouslyAllowAllFiles: true };
  createUrl?: (url: string) => string;
}

/**
 * R2AssetsRepository implements AssetsRepository using Cloudflare R2 as the backing store.
 *
 * This implementation handles binary assets (images, videos, documents, etc.) and provides:
 * - Simple createAsset() that handles multipart uploads internally for large files
 * - Decoupled getPreviews(), getUrls(), getMetadata() methods
 * - Support for JSON:API includes via the `include` option
 */
export class R2AssetsRepository extends AssetsRepository {
  private readonly datasource: R2AssetsDataSource;
  private readonly createUrl?: (url: string) => string;
  private readonly sanitizer?: Sanitizer;

  constructor(options: R2AssetsRepositoryOptions) {
    super();

    // Runtime validation for JavaScript users
    // TypeScript users get compile-time errors via the union type
    const hasSanitizer = 'sanitizer' in options && options.sanitizer !== undefined;
    const hasDangerousFlag = 'dangerouslyAllowAllFiles' in options && options.dangerouslyAllowAllFiles === true;
    if (!hasSanitizer && !hasDangerousFlag) {
      throw new Error(
        'R2AssetsRepository requires either a `sanitizer` to strip privacy-sensitive metadata from files, '
          + 'or `dangerouslyAllowAllFiles: true` to explicitly bypass sanitization. '
          + 'See https://docs.laika-cms.com/security/file-sanitization for more information.',
      );
    }

    this.datasource = new R2AssetsDataSource(options.bucket);
    this.createUrl = options.createUrl;
    const noSanitizer = 'dangerouslyAllowAllFiles' in options && options.dangerouslyAllowAllFiles === true;
    const sanitizer = noSanitizer ? undefined : options.sanitizer as Sanitizer;
    this.sanitizer = 'sanitizer' in options && !noSanitizer ? sanitizer : undefined;
  }

  // ============================================
  // Resource Operations (unified endpoint)
  // ============================================

  async *getResource(key: string, _options?: GetResourceOptions): AsyncGenerator<LaikaResult<Resource[]>> {
    // Check if it's a file first
    const exists = await this.datasource.exists(key);

    if (exists) {
      for await (const result of this.getAsset(key, _options)) {
        if (Result.isFailure(result)) {
          yield failAs<Resource[]>(result.failure);
        } else {
          yield Result.succeed([result.success] as Resource[]);
        }
      }
      return;
    }

    // Check if it's a directory
    const isDir = await this.datasource.isDirectory(key);

    if (isDir) {
      for await (const result of this.getFolder(key)) {
        if (Result.isFailure(result)) {
          yield failAs<Resource[]>(result.failure);
        } else {
          yield Result.succeed([result.success] as Resource[]);
        }
      }
      return;
    }

    yield Result.fail(new NotFoundError(`Resource at ${key} does not exist`));
  }

  async *listResources(
    folderKey: string,
    options: ListResourcesOptions,
  ): AsyncGenerator<LaikaResult<Resource[]>> {
    const depth = Math.max(1, options.depth ?? 1);

    // Helper function to list a single directory
    const listDirectory = async (key: string): Promise<LaikaResult<Resource[]>> => {
      const entriesResult = await this.datasource.listDirectory(key, { includeMetadata: true });

      if (Result.isFailure(entriesResult)) {
        return failAs<Resource[]>(entriesResult.failure);
      }

      const resources: Resource[] = [];

      for (const entry of entriesResult.success) {
        if (entry.type === 'file') {
          resources.push({
            type: 'asset',
            key: entry.key,
            createdAt: entry.uploaded?.toISOString() ?? new Date().toISOString(),
            updatedAt: entry.uploaded?.toISOString() ?? new Date().toISOString(),
            content: {
              size: entry.size,
              etag: entry.etag,
              contentType: entry.httpMetadata?.contentType,
              customMetadata: entry.customMetadata,
            },
          });
        } else {
          // Folder
          resources.push({
            type: 'folder',
            key: entry.key,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      return Result.succeed(resources);
    };

    // Recursive helper to list with depth
    const listRecursive = async (key: string, currentDepth: number): Promise<LaikaResult<Resource[]>> => {
      const result = await listDirectory(key);

      if (Result.isFailure(result)) {
        return result;
      }

      const resources = [...result.success];

      // If we haven't reached max depth, recurse into folders
      if (currentDepth < depth) {
        const folders = result.success.filter((r: Resource) => r.type === 'folder');

        for (const folder of folders) {
          const subResult = await listRecursive(folder.key, currentDepth + 1);
          if (Result.isSuccess(subResult)) {
            resources.push(...subResult.success);
          }
          // Continue even if a subfolder fails
        }
      }

      return Result.succeed(resources);
    };

    const result = await listRecursive(folderKey, 1);
    yield result;
  }

  // ============================================
  // Asset Operations
  // ============================================

  async *getAsset(key: string, _options?: GetResourceOptions): AsyncGenerator<LaikaResult<Asset>> {
    const metaResult = await this.datasource.getObjectMeta(key);

    if (Result.isFailure(metaResult)) {
      yield failAs<Asset>(metaResult.failure);
      return;
    }

    const meta = metaResult.success;

    const asset: Asset = {
      type: 'asset',
      key: meta.key,
      createdAt: meta.uploaded.toISOString(),
      updatedAt: meta.uploaded.toISOString(),
      content: {
        size: meta.size,
        etag: meta.etag,
        contentType: meta.contentType,
        customMetadata: meta.customMetadata,
      },
    };

    yield Result.succeed(asset);
  }

  async getAssetContent(key: string): Promise<
    LaikaResult<{
      body: ArrayBuffer | ReadableStream,
      contentType: string,
      size: number,
    }>
  > {
    const bodyResult = await this.datasource.getObjectBody(key);

    if (Result.isFailure(bodyResult)) {
      return failAs<{ body: ArrayBuffer | ReadableStream, contentType: string, size: number }>(bodyResult.failure);
    }

    return Result.succeed({
      body: bodyResult.success.body,
      contentType: bodyResult.success.meta.contentType || 'application/octet-stream',
      size: bodyResult.success.meta.size,
    });
  }

  async *createAsset(create: AssetCreate): AsyncGenerator<LaikaResult<Asset>> {
    let body: Uint8Array;

    // Convert content to Uint8Array for sanitization
    if (create.content instanceof ArrayBuffer) {
      body = new Uint8Array(create.content);
    } else if (create.content instanceof Uint8Array) {
      body = create.content;
    } else if (create.content instanceof ReadableStream) {
      // For streams, collect into a Uint8Array
      const reader = create.content.getReader();
      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalSize += value.byteLength;
      }

      // Combine chunks
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }

      body = combined;
    } else {
      yield Result.fail(new BadRequestError('Content must be ArrayBuffer, Uint8Array, or ReadableStream'));
      return;
    }

    // Apply sanitization if a sanitizer is configured
    // This strips privacy-sensitive metadata from files
    if (this.sanitizer) {
      const sanitizeResult = await this.sanitizer.sanitize(body, {}, create.mimeType);
      body = sanitizeResult.data;
    }

    // Simple single-request upload
    const putResult = await this.datasource.putObject(create.key, body, {
      contentType: create.mimeType,
      cacheControl: create.cacheControl,
      customMetadata: create.customMetadata,
    });

    if (Result.isFailure(putResult)) {
      yield failAs<Asset>(putResult.failure);
      return;
    }

    yield* this.getAsset(create.key);
  }

  async *updateAsset(update: AssetUpdate): AsyncGenerator<LaikaResult<Asset>> {
    // AssetUpdate only updates metadata, not content
    // R2 doesn't support updating metadata without re-uploading
    // So we need to download and re-upload with new metadata

    const existingResult = await this.datasource.getObjectBody(update.key);
    if (Result.isFailure(existingResult)) {
      yield failAs<Asset>(existingResult.failure);
      return;
    }

    const { body, meta } = existingResult.success;

    // Re-upload with updated metadata
    const putResult = await this.datasource.putObject(update.key, body, {
      contentType: update.mimeType || meta.contentType || 'application/octet-stream',
      cacheControl: update.cacheControl,
      customMetadata: update.customMetadata || meta.customMetadata,
    });

    if (Result.isFailure(putResult)) {
      yield failAs<Asset>(putResult.failure);
      return;
    }

    yield* this.getAsset(update.key);
  }

  async *deleteAsset(key: string): AsyncGenerator<LaikaResult<void>> {
    yield await this.datasource.deleteObject(key);
  }

  async *deleteAssets(keys: readonly string[]): AsyncGenerator<LaikaResult<string[]>> {
    const deletedKeys: string[] = [];
    const errors: string[] = [];

    for await (const result of this.datasource.deleteObjects(keys)) {
      if (Result.isSuccess(result)) {
        deletedKeys.push(result.success);
      } else {
        errors.push(result.failure.message);
      }
    }

    if (errors.length > 0 && deletedKeys.length === 0) {
      yield Result.fail(new InternalError(`Failed to delete assets: ${errors.join(', ')}`));
    } else {
      yield Result.succeed(deletedKeys);
    }
  }

  async *getVariations(assets: Asset[]): AsyncGenerator<LaikaResult<AssetVariations[]>> {
    yield Result.succeed(assets.map(asset => ({
      key: asset.key,
      variations: {},
    })));
  }

  async *getUrls(assets: Asset[]): AsyncGenerator<LaikaResult<AssetUrl[]>> {
    yield Result.succeed(assets.map(asset => ({
      key: asset.key,
      url: this.createUrl ? this.createUrl(asset.key) : asset.key,
    })));
  }

  async *getMetadata(assets: Asset[]): AsyncGenerator<LaikaResult<AssetMetadata[]>> {
    const metas = await Promise.allSettled(
      assets.map(asset => this.datasource.getObjectMeta(asset.key)),
    );

    const successfulMetas: AssetMetadata[] = [];
    const failedResults: LaikaResult<AssetMetadata[]>[] = [];

    for (const metaResult of metas) {
      if (metaResult.status === 'fulfilled') {
        const result = metaResult.value;
        if (Result.isSuccess(result)) {
          const meta = result.success;
          const metadata: AssetMetadataContent = {
            size: meta.size,
            kind: 'binary',
            mimeType: meta.contentType || 'application/octet-stream',
          };
          successfulMetas.push({
            key: meta.key,
            metadata,
          });
        } else {
          failedResults.push(failAs<AssetMetadata[]>(result.failure));
        }
      } else {
        failedResults.push(
          Result.fail(
            new InternalError(
              metaResult.reason instanceof Error ? metaResult.reason.message : String(metaResult.reason),
            ),
          ),
        );
      }
    }

    if (successfulMetas.length > 0) {
      yield Result.succeed(successfulMetas);
    }

    for (const fail of failedResults) {
      yield fail;
    }
  }

  // ============================================
  // Folder Operations
  // ============================================

  async *getFolder(key: string): AsyncGenerator<LaikaResult<Folder>> {
    const metaResult = await this.datasource.getFolderMeta(key);

    if (Result.isFailure(metaResult)) {
      yield failAs<Folder>(metaResult.failure);
      return;
    }

    const folder: Folder = {
      type: 'folder',
      key,
      createdAt: metaResult.success.createdAt.toISOString(),
      updatedAt: metaResult.success.updatedAt.toISOString(),
    };

    yield Result.succeed(folder);
  }

  async *createFolder(folderCreate: FolderCreate): AsyncGenerator<LaikaResult<Folder>> {
    const createResult = await this.datasource.createFolder(folderCreate.key);

    if (Result.isFailure(createResult)) {
      yield failAs<Folder>(createResult.failure);
      return;
    }

    yield* this.getFolder(folderCreate.key);
  }

  async *deleteFolder(key: string, recursive?: boolean): AsyncGenerator<LaikaResult<void>> {
    yield await this.datasource.deleteFolder(key, recursive);
  }
}
