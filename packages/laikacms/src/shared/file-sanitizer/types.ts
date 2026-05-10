/**
 * File Sanitizer Types
 *
 * Uses a BLOCKLIST approach - only strips chunks/segments known to contain
 * privacy-sensitive or dangerous metadata. Unknown and unrecognized chunks
 * are preserved to avoid breaking file functionality.
 *
 * Supported file types are sanitized by stripping dangerous metadata.
 * Unsupported file types are scanned for dangerous content and rejected
 * if found, or rejected as unsupported.
 */

/**
 * File types that can be safely sanitized (simple chunk-based formats)
 */
export type SanitizableFileType =
  | 'png' // Simple chunk-based format
  | 'gif' // Simple block-based format
  | 'webp' // Simple chunk-based format (RIFF container)
  | 'jpeg'; // Marker-based format (strips EXIF/IPTC/XMP)

/**
 * All detectable file types
 * Note: 'unknown' and any non-sanitizable type throws an error (unless in ignoreExtensions)
 */
export type DetectedFileType =
  | SanitizableFileType
  | 'tiff'
  | 'heic'
  | 'heif'
  | 'mp4'
  | 'mov'
  | 'avi'
  | 'pdf'
  | 'unknown';

/**
 * Options for sanitization
 */
export interface SanitizeOptions {
  /**
   * Maximum file size in bytes (default: 100MB)
   * @default 104857600
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
 * Successful sanitization result
 */
export interface SanitizeResult {
  /**
   * The sanitized file data
   */
  data: Uint8Array;

  /**
   * Detected file type
   */
  fileType: SanitizableFileType | 'ignored';

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
 * Interface for file type specific sanitizers
 */
export interface FileSanitizer {
  /**
   * The file type this sanitizer handles
   */
  readonly fileType: SanitizableFileType;

  /**
   * Check if this sanitizer can handle the given data
   */
  canHandle(data: Uint8Array): boolean;

  /**
   * Sanitize the file data
   * @throws {CorruptedFileError} if the file is corrupted
   */
  sanitize(data: Uint8Array, options: SanitizeOptions): Promise<SanitizeResult>;
}

/**
 * PNG chunks that contain privacy-sensitive metadata (always stripped)
 */
export const PNG_METADATA_CHUNKS = new Set([
  'tEXt', // Text metadata
  'zTXt', // Compressed text metadata
  'iTXt', // International text metadata
  'tIME', // Last modification time
  'eXIf', // EXIF data (PNG 1.5+)
]);

/**
 * Sanitizable file types list
 */
export const SANITIZABLE_FILE_TYPES: readonly SanitizableFileType[] = ['png', 'gif', 'webp', 'jpeg'];

/**
 * Check if a file type is sanitizable (in our supported list)
 */
export function isSanitizableFileType(type: DetectedFileType): type is SanitizableFileType {
  return (SANITIZABLE_FILE_TYPES as readonly string[]).includes(type);
}

/**
 * Create an ignored result (file returned without modification)
 */
export function ignoredResult(data: Uint8Array): SanitizeResult {
  return {
    data,
    fileType: 'ignored',
    strippedMetadata: {
      hadTextMetadata: false,
      hadTimestamps: false,
      strippedChunks: [],
    },
    ignored: true,
  };
}
