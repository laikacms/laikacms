/**
 * FileSanitizerImpl - Implementation of the abstract Sanitizer interface
 * 
 * Provides file sanitization for PNG, GIF, and WebP files.
 */

import type { 
  Sanitizer, 
  SanitizeOptions as AbstractSanitizeOptions, 
  SanitizeResult as AbstractSanitizeResult 
} from '@laikacms/sanitizer';
import { sanitizeFile, canSanitize, getSupportedFileTypes } from './sanitizer.js';

/**
 * File sanitizer implementation that strips privacy-sensitive metadata from files.
 * 
 * Implements the abstract Sanitizer interface from @laikacms/sanitizer.
 * 
 * @example
 * ```typescript
 * import { FileSanitizerImpl } from '@laikacms/file-sanitizer';
 * 
 * const sanitizer = new FileSanitizerImpl();
 * 
 * // Check supported types
 * console.log(sanitizer.getSupportedFileTypes()); // ['png', 'gif', 'webp']
 * 
 * // Sanitize a file
 * const result = await sanitizer.sanitize(fileData);
 * ```
 */
export class FileSanitizerImpl implements Sanitizer {
  /**
   * Sanitize a file, stripping privacy-sensitive metadata
   * 
   * @param data - The file data as a Uint8Array
   * @param options - Sanitization options
   * @param expectedMimeType - Optional expected MIME type for validation
   * @returns SanitizeResult - the sanitized file data and metadata
   * @throws {FileTooLargeError} if file exceeds maxFileSize
   * @throws {UnsupportedFileTypeError} if file type is not supported or MIME type mismatch
   * @throws {CorruptedFileError} if file is corrupted
   */
  async sanitize(
    data: Uint8Array,
    options?: AbstractSanitizeOptions,
    expectedMimeType?: string
  ): Promise<AbstractSanitizeResult> {
    return sanitizeFile(data, options, expectedMimeType);
  }
  
  /**
   * Get a list of supported file types/extensions
   */
  getSupportedFileTypes(): readonly string[] {
    return getSupportedFileTypes();
  }
  
  /**
   * Check if a file can be sanitized (without actually sanitizing it)
   * Useful for validation before upload
   */
  canSanitize(data: Uint8Array): {
    canSanitize: boolean;
    detectedType: string;
    reason?: string;
  } {
    return canSanitize(data);
  }
}
