/**
 * Abstract Sanitizer Interface
 * 
 * Provides a generic interface for file sanitization that can be implemented
 * by different sanitizer implementations (e.g., file-sanitizer for images).
 * 
 * This abstraction allows consumers (like assets-r2) to depend on the interface
 * rather than a specific implementation, enabling dependency injection.
 */

/**
 * Options for sanitization
 */
export interface SanitizeOptions {
  /**
   * Maximum file size in bytes
   * @default 104857600 (100MB)
   */
  maxFileSize?: number;
  
  /**
   * File extensions to ignore (pass through unchanged without sanitization).
   * Use this when you have other security measures in place for certain file types.
   * 
   * Example: ['pdf', 'jpeg', 'jpg'] - these files will be returned unchanged
   * 
   * WARNING: Use with caution - this bypasses security checks for
   * the specified file types.
   * 
   * @default []
   */
  ignoreExtensions?: string[];
}

/**
 * Information about what metadata was stripped
 */
export interface StrippedMetadataInfo {
  /**
   * Whether any text metadata was found and stripped
   */
  hadTextMetadata: boolean;
  
  /**
   * Whether any timestamp data was found and stripped
   */
  hadTimestamps: boolean;
  
  /**
   * List of chunk/block types that were stripped (for debugging)
   */
  strippedChunks?: string[];
}

/**
 * Result of sanitization
 */
export interface SanitizeResult {
  /**
   * The sanitized file data
   */
  data: Uint8Array;
  
  /**
   * Detected file type (implementation-specific)
   */
  fileType: string;
  
  /**
   * Metadata that was stripped (for logging/debugging)
   */
  strippedMetadata: StrippedMetadataInfo;
  
  /**
   * Whether the file was passed through without modification (ignored)
   */
  ignored: boolean;
}

/**
 * Abstract sanitizer interface
 * 
 * Implementations should:
 * - Throw errors for unsupported file types (unless in ignoreExtensions)
 * - Throw errors for corrupted files
 * - Throw errors for files exceeding maxFileSize
 * - Return sanitized data with metadata about what was stripped
 */
export interface Sanitizer {
  /**
   * Sanitize a file, stripping privacy-sensitive metadata
   * 
   * @param data - The file data as a Uint8Array
   * @param options - Sanitization options
   * @param expectedMimeType - Optional expected MIME type for validation
   * @returns SanitizeResult - the sanitized file data and metadata
   * @throws Error if file type is not supported, file is corrupted, or file is too large
   */
  sanitize(
    data: Uint8Array,
    options?: SanitizeOptions,
    expectedMimeType?: string
  ): Promise<SanitizeResult>;
  
  /**
   * Get a list of supported file types/extensions
   */
  getSupportedFileTypes(): readonly string[];
  
  /**
   * Check if a file can be sanitized (without actually sanitizing it)
   * Useful for validation before upload
   */
  canSanitize(data: Uint8Array): {
    canSanitize: boolean;
    detectedType: string;
    reason?: string;
  };
}
