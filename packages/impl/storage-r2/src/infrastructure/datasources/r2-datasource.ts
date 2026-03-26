import {
  failure,
  ForbiddenError,
  InternalError,
  NotFoundError,
  Result,
  ResultError,
  success
} from '@laikacms/core';
import { R2Entry, R2FileOrDir } from '../../domain/entities/r2-object.js';

/**
 * R2DataSource provides low-level operations for interacting with Cloudflare R2 storage.
 * It handles the translation between the flat object store model and a hierarchical file system model.
 */
export class R2DataSource {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly availableExtensions: string[] = [],
    private readonly defaultFileExtension: string = ''
  ) {}

  /**
   * Strip any extension from the key if it matches one of the available extensions.
   * This ensures the interface never exposes file extensions.
   */
  private stripExtension(key: string): string {
    for (const ext of this.availableExtensions) {
      if (key.endsWith(`.${ext}`)) {
        return key.slice(0, -(ext.length + 1));
      }
    }
    return key;
  }

  /**
   * Normalize a key by removing leading/trailing slashes and handling empty keys
   */
  private normalizeKey(key: string): string {
    // Remove leading and trailing slashes
    return key.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Resolve a key (without extension) to the actual object key with extension.
   * Tries to find the object with any available extension.
   * Returns the resolved key with extension, or null if not found.
   */
  private async resolveKeyWithExtension(key: string): Promise<string | null> {
    const normalizedKey = this.normalizeKey(key);
    const keyWithoutExt = this.stripExtension(normalizedKey);
    
    // Try to find object with any available extension
    for (const ext of this.availableExtensions) {
      const keyWithExt = `${keyWithoutExt}.${ext}`;
      const object = await this.bucket.head(keyWithExt);
      
      if (object) {
        return keyWithExt;
      }
    }
    
    // No object found with any extension
    return null;
  }

  /**
   * Check if an object exists with any of the available extensions.
   * Returns the extension if found, null otherwise.
   */
  async findExistingObjectExtension(key: string): Promise<string | null> {
    const normalizedKey = this.normalizeKey(key);
    const keyWithoutExt = this.stripExtension(normalizedKey);
    
    for (const ext of this.availableExtensions) {
      const keyWithExt = `${keyWithoutExt}.${ext}`;
      const object = await this.bucket.head(keyWithExt);
      
      if (object) {
        return ext;
      }
    }
    
    return null;
  }

  /**
   * Delete multiple objects from R2
   */
  async deleteObjects(keys: readonly string[]): Promise<Result<string[]>> {
    const deletedKeys: string[] = [];
    const errorMessages: string[] = [];

    for (const key of keys) {
      try {
        const resolvedKey = await this.resolveKeyWithExtension(key);
        
        if (!resolvedKey) {
          errorMessages.push(`Object at ${key} does not exist`);
          continue;
        }

        await this.bucket.delete(resolvedKey);
        deletedKeys.push(this.stripExtension(resolvedKey));
      } catch (error) {
        errorMessages.push(error instanceof Error ? error.message : String(error));
      }
    }

    return success(deletedKeys, errorMessages);
  }

  /**
   * Get the contents of an object
   */
  async getObjectContents(key: string): Promise<Result<{ content: string; key: string; extension: string }>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      const resolvedKey = await this.resolveKeyWithExtension(normalizedKey);
      
      if (!resolvedKey) {
        return failure(NotFoundError.CODE, [`Object at ${key} does not exist`]);
      }
      
      const object = await this.bucket.get(resolvedKey);
      
      if (!object) {
        return failure(NotFoundError.CODE, [`Object at ${key} does not exist`]);
      }

      const content = await object.text();
      
      // Extract extension from resolved key
      const lastDot = resolvedKey.lastIndexOf('.');
      const extension = lastDot > 0 ? resolvedKey.slice(lastDot + 1) : '';
      
      // Return key without extension for the interface
      const keyWithoutExt = this.stripExtension(resolvedKey);
      
      return success({ content, key: keyWithoutExt, extension });
    } catch (error) {
      console.error(error);
      return failure(InternalError.CODE, [`Failed to get object contents: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  /**
   * Get metadata for an object
   */
  async getObjectMeta(key: string): Promise<Result<{ 
    size: number; 
    createdAt: Date; 
    updatedAt: Date; 
    key: string; 
    extension: string;
    etag: string;
  }>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      const resolvedKey = await this.resolveKeyWithExtension(normalizedKey);
      
      if (!resolvedKey) {
        return failure(NotFoundError.CODE, [`Object at ${key} does not exist`]);
      }
      
      const object = await this.bucket.head(resolvedKey);
      
      if (!object) {
        return failure(NotFoundError.CODE, [`Object at ${key} does not exist`]);
      }

      // Extract extension from resolved key
      const lastDot = resolvedKey.lastIndexOf('.');
      const extension = lastDot > 0 ? resolvedKey.slice(lastDot + 1) : '';
      
      // Return key without extension for the interface
      const keyWithoutExt = this.stripExtension(resolvedKey);
      
      // R2 doesn't have a separate created time, so we use uploaded time for both
      const uploadedDate = object.uploaded;
      
      return success({ 
        size: object.size, 
        createdAt: uploadedDate, 
        updatedAt: uploadedDate, 
        key: keyWithoutExt, 
        extension,
        etag: object.etag
      });
    } catch (error) {
      console.error(error);
      return failure(InternalError.CODE, [`Failed to get object metadata: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  /**
   * Get metadata for a "folder" (prefix in R2)
   * Since R2 is a flat object store, folders don't have real metadata.
   * We return the current time as a placeholder.
   */
  async getFolderMeta(key: string): Promise<Result<{ createdAt: Date; updatedAt: Date }>> {
    const normalizedKey = this.normalizeKey(key);
    const prefix = normalizedKey ? `${normalizedKey}/` : '';
    
    try {
      // Check if any objects exist with this prefix
      const listed = await this.bucket.list({ prefix, limit: 1 });
      
      if (listed.objects.length === 0 && listed.delimitedPrefixes.length === 0) {
        return failure(NotFoundError.CODE, [`Folder at ${key} does not exist`]);
      }

      // R2 folders don't have real timestamps, use current time
      const now = new Date();
      return success({ createdAt: now, updatedAt: now });
    } catch (error) {
      console.error(error);
      return failure(InternalError.CODE, [`Failed to get folder metadata: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  /**
   * List objects in a "directory" (prefix in R2)
   */
  async listDirectory(prefix: string): Promise<Result<R2Entry[]>> {
    const normalizedPrefix = this.normalizeKey(prefix);
    const searchPrefix = normalizedPrefix ? `${normalizedPrefix}/` : '';
    
    try {
      const entries: R2Entry[] = [];
      let cursor: string | undefined;
      
      do {
        const listed = await this.bucket.list({
          prefix: searchPrefix,
          delimiter: '/',
          cursor,
        });

        // Add files (objects)
        for (const object of listed.objects) {
          // Skip the prefix itself if it's a .keep file
          if (object.key.endsWith('/.keep') || object.key === '.keep') {
            continue;
          }
          
          entries.push({
            type: 'file',
            key: object.key,
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
   * Create or update an object in R2
   */
  async createOrUpdate(
    key: string,
    content: string,
    extension: string
  ): Promise<Result<{ key: string }>> {
    const normalizedKey = this.normalizeKey(key);
    // Strip any extension user may have added and use the provided extension
    const keyWithoutExt = this.stripExtension(normalizedKey);
    const keyWithExt = extension ? `${keyWithoutExt}.${extension}` : keyWithoutExt;
    
    try {
      await this.bucket.put(keyWithExt, content, {
        httpMetadata: {
          contentType: this.getContentType(extension),
        },
      });

      // Return key without extension for the interface
      return success({ key: keyWithoutExt });
    } catch (error) {
      console.error(error);
      return ResultError.fromError(error).toResult();
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
   * Check if a key represents a file (object exists)
   */
  async isFile(key: string): Promise<boolean> {
    const resolvedKey = await this.resolveKeyWithExtension(key);
    return resolvedKey !== null;
  }

  /**
   * Get the content type for a file extension
   */
  private getContentType(extension: string): string {
    const contentTypes: Record<string, string> = {
      'json': 'application/json',
      'md': 'text/markdown',
      'yaml': 'text/yaml',
      'yml': 'text/yaml',
      'txt': 'text/plain',
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'ts': 'application/typescript',
      'xml': 'application/xml',
    };
    
    return contentTypes[extension] || 'application/octet-stream';
  }
}
