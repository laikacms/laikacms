import {
  failure,
  InternalError,
  NotFoundError,
  Result,
  ResultError,
  success
} from '@laikacms/core';

/**
 * Entry in an R2 directory listing
 */
export interface R2AssetEntry {
  type: 'file' | 'dir';
  key: string;
  size?: number;
  etag?: string;
  uploaded?: Date;
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
}

/**
 * Metadata for an R2 object
 */
export interface R2AssetMeta {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  contentType?: string;
  customMetadata?: Record<string, string>;
}

/**
 * R2AssetsDataSource provides low-level operations for binary assets in Cloudflare R2.
 * Unlike the storage datasource which handles text serialization, this handles raw binary data.
 */
export class R2AssetsDataSource {
  constructor(
    private readonly bucket: R2Bucket
  ) {}

  /**
   * Normalize a key by removing leading/trailing slashes
   */
  private normalizeKey(key: string): string {
    return key.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Check if an object exists
   */
  async exists(key: string): Promise<boolean> {
    const normalizedKey = this.normalizeKey(key);
    const object = await this.bucket.head(normalizedKey);
    return object !== null;
  }

  /**
   * Get object metadata without fetching the body
   */
  async getObjectMeta(key: string): Promise<Result<R2AssetMeta>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      const object = await this.bucket.head(normalizedKey);
      
      if (!object) {
        return failure(NotFoundError.CODE, [`Asset at ${key} does not exist`]);
      }

      return success({
        key: normalizedKey,
        size: object.size,
        etag: object.etag,
        uploaded: object.uploaded,
        contentType: object.httpMetadata?.contentType,
        customMetadata: object.customMetadata,
      });
    } catch (error) {
      console.error(error);
      return failure(InternalError.CODE, [`Failed to get asset metadata: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  /**
   * Get object body as ArrayBuffer
   */
  async getObjectBody(key: string): Promise<Result<{ body: ArrayBuffer; meta: R2AssetMeta }>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      const object = await this.bucket.get(normalizedKey);
      
      if (!object) {
        return failure(NotFoundError.CODE, [`Asset at ${key} does not exist`]);
      }

      const body = await object.arrayBuffer();
      
      return success({
        body,
        meta: {
          key: normalizedKey,
          size: object.size,
          etag: object.etag,
          uploaded: object.uploaded,
          contentType: object.httpMetadata?.contentType,
          customMetadata: object.customMetadata,
        }
      });
    } catch (error) {
      console.error(error);
      return failure(InternalError.CODE, [`Failed to get asset body: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  /**
   * Get object body as ReadableStream
   */
  async getObjectStream(key: string): Promise<Result<{ stream: ReadableStream; meta: R2AssetMeta }>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      const object = await this.bucket.get(normalizedKey);
      
      if (!object) {
        return failure(NotFoundError.CODE, [`Asset at ${key} does not exist`]);
      }

      return success({
        stream: object.body,
        meta: {
          key: normalizedKey,
          size: object.size,
          etag: object.etag,
          uploaded: object.uploaded,
          contentType: object.httpMetadata?.contentType,
          customMetadata: object.customMetadata,
        }
      });
    } catch (error) {
      console.error(error);
      return failure(InternalError.CODE, [`Failed to get asset stream: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  /**
   * Put an object (create or update)
   */
  async putObject(
    key: string,
    body: ReadableStream | ArrayBuffer | ArrayBufferView | string | Uint8Array,
    options?: {
      contentType?: string;
      cacheControl?: string;
      customMetadata?: Record<string, string>;
    }
  ): Promise<Result<R2AssetMeta>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      
      const object = await this.bucket.put(normalizedKey, body, {
        httpMetadata: {
          contentType: options?.contentType || 'application/octet-stream',
          cacheControl: options?.cacheControl,
        },
        customMetadata: options?.customMetadata,
      });

      return success({
        key: normalizedKey,
        size: object.size,
        etag: object.etag,
        uploaded: object.uploaded,
        contentType: options?.contentType,
        customMetadata: options?.customMetadata,
      });
    } catch (error) {
      console.error(error);
      return ResultError.fromError(error).toResult();
    }
  }

  /**
   * Delete an object
   */
  async deleteObject(key: string): Promise<Result<void>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      await this.bucket.delete(normalizedKey);
      return success(undefined);
    } catch (error) {
      console.error(error);
      return ResultError.fromError(error).toResult();
    }
  }

  /**
   * Delete multiple objects
   */
  async deleteObjects(keys: readonly string[]): Promise<Result<string[]>> {
    const deletedKeys: string[] = [];
    const errorMessages: string[] = [];

    for (const key of keys) {
      try {
        const normalizedKey = this.normalizeKey(key);
        await this.bucket.delete(normalizedKey);
        deletedKeys.push(normalizedKey);
      } catch (error) {
        errorMessages.push(error instanceof Error ? error.message : String(error));
      }
    }

    return success(deletedKeys, errorMessages);
  }

  /**
   * List objects in a "directory" (prefix)
   */
  async listDirectory(prefix: string, options?: { includeMetadata?: boolean }): Promise<Result<R2AssetEntry[]>> {
    const normalizedPrefix = this.normalizeKey(prefix);
    const searchPrefix = normalizedPrefix ? `${normalizedPrefix}/` : '';
    
    try {
      const entries: R2AssetEntry[] = [];
      let cursor: string | undefined;
      
      do {
        const listed = await this.bucket.list({
          prefix: searchPrefix,
          delimiter: '/',
          cursor,
          include: options?.includeMetadata ? ['httpMetadata', 'customMetadata'] : undefined,
        });

        // Add files (objects)
        for (const object of listed.objects) {
          // Skip .keep files used for empty folders
          if (object.key.endsWith('/.keep') || object.key === '.keep') {
            continue;
          }
          
          entries.push({
            type: 'file',
            key: object.key,
            size: object.size,
            etag: object.etag,
            uploaded: object.uploaded,
            httpMetadata: object.httpMetadata ? {
              contentType: object.httpMetadata.contentType,
            } : undefined,
            customMetadata: object.customMetadata,
          });
        }

        // Add directories (common prefixes)
        for (const commonPrefix of listed.delimitedPrefixes) {
          // Remove trailing slash from prefix
          const dirKey = commonPrefix.replace(/\/$/, '');
          entries.push({
            type: 'dir',
            key: dirKey,
          });
        }

        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);

      return success(entries);
    } catch (error) {
      console.error(error);
      return failure(InternalError.CODE, [`Failed to list directory: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  /**
   * Check if a key represents a directory (has objects with that prefix)
   */
  async isDirectory(key: string): Promise<boolean> {
    const normalizedKey = this.normalizeKey(key);
    const prefix = normalizedKey ? `${normalizedKey}/` : '';
    
    try {
      const listed = await this.bucket.list({ prefix, limit: 1 });
      return listed.objects.length > 0 || listed.delimitedPrefixes.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get folder metadata (for R2, folders don't have real metadata)
   */
  async getFolderMeta(key: string): Promise<Result<{ createdAt: Date; updatedAt: Date }>> {
    const normalizedKey = this.normalizeKey(key);
    const prefix = normalizedKey ? `${normalizedKey}/` : '';
    
    try {
      const listed = await this.bucket.list({ prefix, limit: 1 });
      
      if (listed.objects.length === 0 && listed.delimitedPrefixes.length === 0) {
        return failure(NotFoundError.CODE, [`Folder at ${key} does not exist`]);
      }

      // R2 folders don't have real timestamps
      const now = new Date();
      return success({ createdAt: now, updatedAt: now });
    } catch (error) {
      console.error(error);
      return failure(InternalError.CODE, [`Failed to get folder metadata: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  /**
   * Create an empty folder (using .keep file)
   */
  async createFolder(key: string): Promise<Result<void>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      const keepKey = `${normalizedKey}/.keep`;
      
      await this.bucket.put(keepKey, '');
      return success(undefined);
    } catch (error) {
      console.error(error);
      return ResultError.fromError(error).toResult();
    }
  }

  /**
   * Delete a folder and optionally all its contents
   */
  async deleteFolder(key: string, recursive: boolean = false): Promise<Result<void>> {
    const normalizedKey = this.normalizeKey(key);
    const prefix = normalizedKey ? `${normalizedKey}/` : '';
    
    try {
      if (!recursive) {
        // Check if folder is empty (only .keep file)
        const listed = await this.bucket.list({ prefix, limit: 2 });
        const nonKeepObjects = listed.objects.filter(obj => !obj.key.endsWith('/.keep'));
        
        if (nonKeepObjects.length > 0 || listed.delimitedPrefixes.length > 0) {
          return failure('conflict', ['Folder is not empty. Use recursive=true to delete all contents.']);
        }
      }

      // Delete all objects with this prefix
      let cursor: string | undefined;
      do {
        const listed = await this.bucket.list({ prefix, cursor });
        
        if (listed.objects.length > 0) {
          const keys = listed.objects.map(obj => obj.key);
          await this.bucket.delete(keys);
        }
        
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);

      return success(undefined);
    } catch (error) {
      console.error(error);
      return ResultError.fromError(error).toResult();
    }
  }

  // ============================================
  // Multipart Upload (internal implementation)
  // ============================================

  /**
   * Start a multipart upload
   */
  async startMultipartUpload(
    key: string,
    options?: {
      contentType?: string;
      customMetadata?: Record<string, string>;
    }
  ): Promise<Result<{ uploadId: string }>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      
      const upload = await this.bucket.createMultipartUpload(normalizedKey, {
        httpMetadata: options?.contentType ? {
          contentType: options.contentType,
        } : undefined,
        customMetadata: options?.customMetadata,
      });

      return success({ uploadId: upload.uploadId });
    } catch (error) {
      console.error(error);
      return ResultError.fromError(error).toResult();
    }
  }

  /**
   * Upload a part in a multipart upload
   */
  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: ReadableStream | ArrayBuffer | ArrayBufferView | string | Uint8Array
  ): Promise<Result<{ etag: string; partNumber: number }>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      const upload = this.bucket.resumeMultipartUpload(normalizedKey, uploadId);
      
      const part = await upload.uploadPart(partNumber, body);
      
      return success({
        etag: part.etag,
        partNumber: part.partNumber,
      });
    } catch (error) {
      console.error(error);
      return ResultError.fromError(error).toResult();
    }
  }

  /**
   * Complete a multipart upload
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<Result<R2AssetMeta>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      const upload = this.bucket.resumeMultipartUpload(normalizedKey, uploadId);
      
      const object = await upload.complete(parts);
      
      return success({
        key: normalizedKey,
        size: object.size,
        etag: object.etag,
        uploaded: object.uploaded,
        contentType: object.httpMetadata?.contentType,
        customMetadata: object.customMetadata,
      });
    } catch (error) {
      console.error(error);
      return ResultError.fromError(error).toResult();
    }
  }

  /**
   * Abort a multipart upload
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<Result<void>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      const upload = this.bucket.resumeMultipartUpload(normalizedKey, uploadId);
      
      await upload.abort();
      return success(undefined);
    } catch (error) {
      console.error(error);
      return ResultError.fromError(error).toResult();
    }
  }
}
