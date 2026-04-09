/**
 * @laikacms/file-sanitizer
 *
 * A file sanitizer that strips privacy-sensitive metadata from files.
 * Uses a WHITELIST approach - only PNG, GIF, WebP, and JPEG files are supported.
 * All other file types throw an error (unless in ignoreExtensions list).
 *
 * Implements the abstract Sanitizer interface from @laikacms/sanitizer.
 *
 * @example
 * ```typescript
 * import { FileSanitizerImpl, sanitizeFile, canSanitize, getSupportedFileTypes } from '@laikacms/file-sanitizer';
 *
 * // Using the class (implements Sanitizer interface)
 * const sanitizer = new FileSanitizerImpl();
 * const result = await sanitizer.sanitize(fileData);
 *
 * // Or using standalone functions
 * const check = canSanitize(fileData);
 * if (!check.canSanitize) {
 *   console.error(check.reason);
 *   return;
 * }
 *
 * // Sanitize the file (throws on error)
 * try {
 *   const result = await sanitizeFile(fileData);
 *   console.log('File type:', result.fileType);
 *   console.log('Stripped metadata:', result.strippedMetadata);
 *   // Use result.data (Uint8Array)
 * } catch (error) {
 *   if (error instanceof UnsupportedFileTypeError) {
 *     console.error('Unsupported file type');
 *   } else if (error instanceof CorruptedFileError) {
 *     console.error('File is corrupted');
 *   }
 * }
 *
 * // Sanitize with ignoreExtensions for certain file types
 * const result = await sanitizeFile(fileData, { ignoreExtensions: ['pdf', 'jpeg'] });
 * ```
 */

// Re-export abstract types from @laikacms/sanitizer
export type {
  SanitizeOptions as AbstractSanitizeOptions,
  Sanitizer,
  SanitizeResult as AbstractSanitizeResult,
  StrippedMetadataInfo as AbstractStrippedMetadataInfo,
} from '@laikacms/sanitizer';

// Main sanitizer class (implements Sanitizer interface)
export { FileSanitizerImpl } from './file-sanitizer.js';

// Main sanitizer functions (standalone usage)
export { canSanitize, getSupportedFileTypes, sanitizeFile } from './sanitizer.js';

// Types
export type {
  DetectedFileType,
  FileSanitizer,
  SanitizableFileType,
  SanitizeOptions,
  SanitizeResult,
  StrippedMetadataInfo,
} from './types.js';

// Type guards and utilities
export {
  ignoredResult,
  isSanitizableFileType,
  PNG_METADATA_CHUNKS,
  SAFE_PNG_CHUNKS,
  SANITIZABLE_FILE_TYPES,
} from './types.js';

// Detection utilities
export { detectFileType, getMimeType } from './utils/detect.js';

// Individual sanitizers (for advanced use cases)
export { GifSanitizer } from './sanitizers/gif.js';
export { JpegSanitizer } from './sanitizers/jpeg.js';
export { PngSanitizer } from './sanitizers/png.js';
export { WebpSanitizer } from './sanitizers/webp.js';

// Dangerous content scanners (for scanning unsupported file types)
export {
  GenericScanner,
  getScannersForType,
  Mp4Scanner,
  PdfScanner,
  scanForDangerousContent,
  TiffScanner,
} from './scanners/index.js';

// Scanner types
export type { DangerousContentScanner, DangerousContentType, ScanResult } from './scanners/types.js';

export { dangerousScanResult, emptyScanResult, mergeScanResults } from './scanners/types.js';
