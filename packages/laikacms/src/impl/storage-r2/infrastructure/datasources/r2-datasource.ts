import * as Cause from 'effect/Cause';
import * as Result from 'effect/Result';
import type { LaikaResult } from 'laikacms/core';
import { InternalError, NotFoundError } from 'laikacms/core';
import type { Key } from 'laikacms/storage';
import type { R2Entry } from '../../domain/entities/r2-object.js';

/**
 * R2DataSource provides low-level operations for interacting with Cloudflare R2 storage.
 * It handles the translation between the flat object store model and a hierarchical file system model.
 */
export class R2DataSource {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly availableExtensions: string[] = [],
    private readonly defaultFileExtension: string = '',
  ) {}

  /**
   * Strip any extension from the key if it matches one of the available extensions.
   * This ensures the interface never exposes file extensions.
   */
  private stripExtension(key: Key): Key {
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
  private normalizeKey(key: Key): Key {
    // Remove leading and trailing slashes
    return key.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Resolve a key (without extension) to the actual object key with extension.
   * Tries to find the object with any available extension.
   * Returns the resolved key with extension, or null if not found.
   */
  private async resolveKeyWithExtension(key: Key): Promise<Key | null> {
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
  async findExistingObjectExtension(key: Key): Promise<string | null> {
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
  async *deleteObjects(keys: readonly string[]): AsyncGenerator<LaikaResult<Key>> {
    for (const key of keys) {
      try {
        const resolvedKey = await this.resolveKeyWithExtension(key);

        if (!resolvedKey) {
          yield Result.fail(
            new NotFoundError(`Object at ${key} does not exist`, {
              translation: { message: 'storage.r2.fileNotFound' },
            }),
          );
          continue;
        }

        await this.bucket.delete(resolvedKey);
        const keyWithoutExt = this.stripExtension(resolvedKey);
        yield Result.succeed(keyWithoutExt);
      } catch (error) {
        yield Result.fail(
          new InternalError(`Failed to delete object at ${key}`, {
            cause: Cause.fail(error),
            translation: { message: 'storage.r2.failedToDeleteObject' },
          }),
        );
      }
    }
  }

  /**
   * Get the contents of an object
   */
  async getObjectContents(key: string): Promise<LaikaResult<{ content: string, key: string, extension: string }>> {
    try {
      const normalizedKey = this.normalizeKey(key);
      const resolvedKey = await this.resolveKeyWithExtension(normalizedKey);

      if (!resolvedKey) {
        return Result.fail(
          new NotFoundError(`Object at ${key} cannot be resolved`, {
            translation: { message: 'storage.r2.fileNotFound' },
          }),
        );
      }

      const object = await this.bucket.get(resolvedKey);

      if (!object) {
        return Result.fail(
          new NotFoundError(`Object at ${key} does not exist`, {
            translation: { message: 'storage.r2.fileNotFound' },
          }),
        );
      }

      const content = await object.text();

      // Extract extension from resolved key
      const lastDot = resolvedKey.lastIndexOf('.');
      const extension = lastDot > 0 ? resolvedKey.slice(lastDot + 1) : '';

      // Return key without extension for the interface
      const keyWithoutExt = this.stripExtension(resolvedKey);

      return Result.succeed({ content, key: keyWithoutExt, extension });
    } catch (error) {
      return Result.fail(
        new InternalError(`Failed to get object contents`, {
          cause: Cause.fail(error),
          translation: { message: 'storage.r2.failedToReadObject' },
        }),
      );
    }
  }

  /**
   * Get metadata for an object
   */
  async getObjectMeta(key: string): Promise<
    LaikaResult<{
      size: number,
      createdAt: Date,
      updatedAt: Date,
      key: string,
      extension: string,
      etag: string,
    }>
  > {
    try {
      const normalizedKey = this.normalizeKey(key);
      const resolvedKey = await this.resolveKeyWithExtension(normalizedKey);

      if (!resolvedKey) {
        return Result.fail(
          new NotFoundError(`Object at ${key} cannot be resolved`, {
            translation: { message: 'storage.r2.fileNotFound' },
          }),
        );
      }

      const object = await this.bucket.head(resolvedKey);

      if (!object) {
        return Result.fail(
          new NotFoundError(`Object at ${key} does not exist`, {
            translation: { message: 'storage.r2.fileNotFound' },
          }),
        );
      }

      // Extract extension from resolved key
      const lastDot = resolvedKey.lastIndexOf('.');
      const extension = lastDot > 0 ? resolvedKey.slice(lastDot + 1) : '';

      // Return key without extension for the interface
      const keyWithoutExt = this.stripExtension(resolvedKey);

      // Prefer the stored creation timestamp from custom metadata (set on first write).
      // Falling back to uploaded is intentional for objects written before this fix.
      const createdAtStr = object.customMetadata?.['x-laika-created-at'];
      const uploadedDate = object.uploaded;
      const createdAt = createdAtStr ? new Date(createdAtStr) : uploadedDate;

      return Result.succeed({
        size: object.size,
        createdAt,
        updatedAt: uploadedDate,
        key: keyWithoutExt,
        extension,
        etag: object.etag,
      });
    } catch (error) {
      return Result.fail(
        new InternalError(`Failed to get object metadata`, {
          cause: Cause.fail(error),
          translation: { message: 'storage.r2.failedToGetObjectMetadata' },
        }),
      );
    }
  }

  /**
   * Get metadata for a "folder" (prefix in R2)
   * Since R2 is a flat object store, folders don't have real metadata.
   * We return the current time as a placeholder.
   */
  async getFolderMeta(key: string): Promise<LaikaResult<{ createdAt: Date, updatedAt: Date }>> {
    const normalizedKey = this.normalizeKey(key);
    const prefix = normalizedKey ? `${normalizedKey}/` : '';

    try {
      // Check if any objects exist with this prefix
      const listed = await this.bucket.list({ prefix, limit: 1 });

      if (listed.objects.length === 0 && listed.delimitedPrefixes.length === 0) {
        return Result.fail(
          new NotFoundError(`Folder at ${key} does not exist`, {
            translation: { message: 'storage.r2.directoryNotFound' },
          }),
        );
      }

      // R2 folders don't have real timestamps, use current time
      const now = new Date();
      return Result.succeed({ createdAt: now, updatedAt: now });
    } catch (error) {
      return Result.fail(
        new InternalError(`Failed to get folder metadata`, {
          cause: Cause.fail(error),
          translation: { message: 'storage.r2.failedToGetDirectoryMetadata' },
        }),
      );
    }
  }

  /**
   * List objects in a "directory" (prefix in R2)
   */
  async listDirectory(prefix: string): Promise<LaikaResult<R2Entry[]>> {
    const normalizedPrefix = this.normalizeKey(prefix);
    const searchPrefix = normalizedPrefix ? `${normalizedPrefix}/` : '';

    try {
      const entries: R2Entry[] = [];
      let cursor: string | undefined;
      let hasAnyListing = false;

      do {
        const listed = await this.bucket.list({
          prefix: searchPrefix,
          delimiter: '/',
          cursor,
        });

        if (listed.objects.length > 0 || listed.delimitedPrefixes.length > 0) {
          hasAnyListing = true;
        }

        // Add files (objects)
        for (const object of listed.objects) {
          // Skip .keep files — they mark empty folders but are not real entries
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

      // R2 has no real concept of a folder — an empty prefix is indistinguishable
      // from a non-existent one. If nothing was listed (not even a .keep marker),
      // treat the folder as missing so callers get the same contract as FS/WebDAV.
      if (!hasAnyListing) {
        return Result.fail(
          new NotFoundError(`Folder at ${prefix} does not exist`, {
            translation: { message: 'storage.r2.directoryNotFound' },
          }),
        );
      }

      return Result.succeed(entries);
    } catch (error) {
      return Result.fail(
        new InternalError(`Failed to list directory`, {
          cause: Cause.fail(error),
          translation: { message: 'storage.r2.failedToListDirectory' },
        }),
      );
    }
  }

  /**
   * Create or update an object in R2.
   * Pass `customMetadata` to embed fields that survive subsequent writes (e.g.
   * `x-laika-created-at` set once on creation so `createdAt` never drifts).
   */
  async createOrUpdate(
    key: string,
    content: string,
    extension: string,
    customMetadata?: Record<string, string>,
  ): Promise<LaikaResult<{ key: string }>> {
    const normalizedKey = this.normalizeKey(key);
    // Strip any extension user may have added and use the provided extension
    const keyWithoutExt = this.stripExtension(normalizedKey);
    const keyWithExt = extension ? `${keyWithoutExt}.${extension}` : keyWithoutExt;

    try {
      await this.bucket.put(keyWithExt, content, {
        httpMetadata: {
          contentType: this.getContentType(extension),
        },
        customMetadata,
      });

      // Return key without extension for the interface
      return Result.succeed({ key: keyWithoutExt });
    } catch (error) {
      return Result.fail(
        new InternalError(`Failed to create or update object`, {
          cause: Cause.fail(error),
          translation: { message: 'storage.r2.failedToCreateOrUpdateObject' },
        }),
      );
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
    } catch (error) {
      console.error(error);
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
