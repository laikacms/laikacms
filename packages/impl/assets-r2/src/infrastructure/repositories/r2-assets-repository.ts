import { ErrorResult, failure, InternalError, NotFoundError, Result, success } from '@laikacms/core';
import { Folder, FolderCreate } from '@laikacms/storage';
import {
  AssetsRepository,
  Asset,
  AssetCreate,
  AssetUpdate,
  AssetVariations,
  AssetUrl,
  AssetMetadata,
  AssetMetadataContent,
  Resource,
  GetResourceOptions,
  ListResourcesOptions,
  FetchHints,
} from '@laikacms/assets';
import type { Sanitizer } from '@laikacms/sanitizer';
import { R2AssetMeta, R2AssetsDataSource } from '../datasources/r2-assets-datasource.js';

/**
 * Base configuration options for R2AssetsRepository (without sanitizer)
 */
interface R2AssetsRepositoryOptions {
  /**
   * The R2 bucket to use for storage
   */
  bucket: R2Bucket;
  publicUrlBase: string;  
  sanitizer: Sanitizer | { dangerouslyAllowAllFiles: true };
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
  private readonly publicUrlBase?: string;
  private readonly sanitizer?: Sanitizer;

  constructor(options: R2AssetsRepositoryOptions) {
    super();
    
    // Runtime validation for JavaScript users
    // TypeScript users get compile-time errors via the union type
    const hasSanitizer = 'sanitizer' in options && options.sanitizer !== undefined;
    const hasDangerousFlag = 'dangerouslyAllowAllFiles' in options && options.dangerouslyAllowAllFiles === true;
    if (!hasSanitizer && !hasDangerousFlag) {
      throw new Error(
        'R2AssetsRepository requires either a `sanitizer` to strip privacy-sensitive metadata from files, ' +
        'or `dangerouslyAllowAllFiles: true` to explicitly bypass sanitization. ' +
        'See https://docs.laika-cms.com/security/file-sanitization for more information.'
      );
    }
    
    this.datasource = new R2AssetsDataSource(options.bucket);
    this.publicUrlBase = options.publicUrlBase;
    const noSanitizer = 'dangerouslyAllowAllFiles' in options && options.dangerouslyAllowAllFiles === true;
    const sanitizer = noSanitizer ? undefined : options.sanitizer as Sanitizer;
    this.sanitizer = 'sanitizer' in options && !noSanitizer ? sanitizer : undefined;
  }

  // ============================================
  // Resource Operations (unified endpoint)
  // ============================================

  async getResource(key: string, _options?: GetResourceOptions): Promise<Result<Resource>> {
    // Check if it's a file first
    const exists = await this.datasource.exists(key);
    
    if (exists) {
      return this.getAsset(key, _options);
    }
    
    // Check if it's a directory
    const isDir = await this.datasource.isDirectory(key);
    
    if (isDir) {
      return this.getFolder(key);
    }
    
    return failure(NotFoundError.CODE, [`Resource at ${key} does not exist`]);
  }

  async *listResources(
    folderKey: string,
    options: ListResourcesOptions
  ): AsyncGenerator<Result<readonly Resource[]>> {
    const depth = Math.max(1, options.depth ?? 1);
    
    // Helper function to list a single directory
    const listDirectory = async (key: string): Promise<Result<Resource[]>> => {
      const entriesResult = await this.datasource.listDirectory(key, { includeMetadata: true });
      
      if (!entriesResult.success) {
        return entriesResult;
      }
      
      const resources: Resource[] = [];
      
      for (const entry of entriesResult.data) {
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
      
      return success(resources);
    };
    
    // Recursive helper to list with depth
    const listRecursive = async (key: string, currentDepth: number): Promise<Result<Resource[]>> => {
      const result = await listDirectory(key);
      
      if (!result.success) {
        return result;
      }
      
      const resources = [...result.data];
      
      // If we haven't reached max depth, recurse into folders
      if (currentDepth < depth) {
        const folders = result.data.filter(r => r.type === 'folder');
        
        for (const folder of folders) {
          const subResult = await listRecursive(folder.key, currentDepth + 1);
          if (subResult.success) {
            resources.push(...subResult.data);
          }
          // Continue even if a subfolder fails
        }
      }
      
      return success(resources);
    };
    
    const result = await listRecursive(folderKey, 1);
    yield result as Result<readonly Resource[]>;
  }

  // ============================================
  // Asset Operations
  // ============================================

  async getAsset(key: string, _options?: GetResourceOptions): Promise<Result<Asset>> {
    const metaResult = await this.datasource.getObjectMeta(key);
    
    if (!metaResult.success) return metaResult;
    
    const meta = metaResult.data;
    
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
    
    return success(asset);
  }

  async getAssetContent(key: string): Promise<Result<{
    body: ArrayBuffer | ReadableStream;
    contentType: string;
    size: number;
  }>> {
    const bodyResult = await this.datasource.getObjectBody(key);
    
    if (!bodyResult.success) return bodyResult;
    
    return success({
      body: bodyResult.data.body,
      contentType: bodyResult.data.meta.contentType || 'application/octet-stream',
      size: bodyResult.data.meta.size,
    });
  }

  async createAsset(create: AssetCreate): Promise<Result<Asset>> {
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
      return failure('bad_request', ['Content must be ArrayBuffer, Uint8Array, or ReadableStream']);
    }
    
    // Apply sanitization if a sanitizer is configured
    // This strips privacy-sensitive metadata from files
    if (this.sanitizer) {
      const sanitizeResult = await this.sanitizer.sanitize(body, {}, create.mimeType);
      body = sanitizeResult.data;
    }
    
    const size = body.byteLength;
    
    // Simple single-request upload
    const putResult = await this.datasource.putObject(create.key, body, {
      contentType: create.mimeType,
      cacheControl: create.cacheControl,
      customMetadata: create.customMetadata,
    });
    
    if (!putResult.success) return putResult;
    
    return this.getAsset(create.key);
  }

  async updateAsset(update: AssetUpdate): Promise<Result<Asset>> {
    // AssetUpdate only updates metadata, not content
    // R2 doesn't support updating metadata without re-uploading
    // So we need to download and re-upload with new metadata
    
    const existingResult = await this.datasource.getObjectBody(update.key);
    if (!existingResult.success) return existingResult;
    
    const { body, meta } = existingResult.data;
    
    // Re-upload with updated metadata
    const putResult = await this.datasource.putObject(update.key, body, {
      contentType: update.mimeType || meta.contentType || 'application/octet-stream',
      cacheControl: update.cacheControl,
      customMetadata: update.customMetadata || meta.customMetadata,
    });
    
    if (!putResult.success) return putResult;
    
    return this.getAsset(update.key);
  }

  async deleteAsset(key: string): Promise<Result<void>> {
    return this.datasource.deleteObject(key);
  }

  async *deleteAssets(keys: readonly string[]): AsyncGenerator<Result<readonly string[]>> {
    const result = await this.datasource.deleteObjects(keys);
    
    if (result.success) {
      yield success(result.data as readonly string[], [...result.messages]);
    } else {
      yield result;
    }
  }

  async *getVariations(assets: Asset[]): AsyncGenerator<Result<AssetVariations[]>> {
    yield success(assets.map(asset => ({
      key: asset.key,
      variations: {},
    })));
  }

  async *getUrls(assets: Asset[]): AsyncGenerator<Result<AssetUrl[]>> {
    yield success(assets.map(asset => ({
      key: asset.key,
      url: this.publicUrlBase ? `${this.publicUrlBase}/${asset.key}` : undefined,
    })));
  }

  async *getMetadata(assets: Asset[]): AsyncGenerator<Result<AssetMetadata[]>> {
    const metas = await Promise.allSettled(
      assets.map(asset => this.datasource.getObjectMeta(asset.key))
    );
    const successes = metas.filter(m => m.status === 'fulfilled' && m.value.success) as PromiseFulfilledResult<Result<R2AssetMeta>>[];
    const failures = metas.filter(m => m.status === 'rejected' || (m.status === 'fulfilled' && !m.value.success)) as (PromiseRejectedResult | PromiseFulfilledResult<Result<R2AssetMeta>>)[];

    yield success(successes.map(s => {
      const meta = s.value.orThrow();
      const metadata: AssetMetadataContent = {
        size: meta.size,
        kind: 'binary',
        mimeType: meta.contentType || 'application/octet-stream',
      };
      return {
        key: meta.key,
        metadata,
      };
    }));
    for (const fail of failures) {
      if (fail.status === 'rejected') {
        yield failure(InternalError.CODE, [fail.reason instanceof Error ? fail.reason.message : String(fail.reason)]);
      } else {
        yield fail.value as ErrorResult;
      }
    }
  }

  // ============================================
  // Folder Operations
  // ============================================

  async getFolder(key: string): Promise<Result<Folder>> {
    const metaResult = await this.datasource.getFolderMeta(key);
    
    if (!metaResult.success) return metaResult;
    
    const folder: Folder = {
      type: 'folder',
      key,
      createdAt: metaResult.data.createdAt.toISOString(),
      updatedAt: metaResult.data.updatedAt.toISOString(),
    };
    
    return success(folder);
  }

  async createFolder(folderCreate: FolderCreate): Promise<Result<Folder>> {
    const createResult = await this.datasource.createFolder(folderCreate.key);
    
    if (!createResult.success) return createResult;
    
    return this.getFolder(folderCreate.key);
  }

  async deleteFolder(key: string, recursive?: boolean): Promise<Result<void>> {
    return this.datasource.deleteFolder(key, recursive);
  }
}

