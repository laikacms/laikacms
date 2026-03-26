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
  Sanitizer,
  SanitizeOptions as AbstractSanitizeOptions,
  SanitizeResult as AbstractSanitizeResult,
  StrippedMetadataInfo as AbstractStrippedMetadataInfo,
} from '@laikacms/sanitizer';

// Main sanitizer class (implements Sanitizer interface)
export { FileSanitizerImpl } from './file-sanitizer.js';

// Main sanitizer functions (standalone usage)
export { sanitizeFile, canSanitize, getSupportedFileTypes } from './sanitizer.js';

// Types
export type {
  SanitizableFileType,
  DetectedFileType,
  SanitizeOptions,
  SanitizeResult,
  StrippedMetadataInfo,
  FileSanitizer,
} from './types.js';

// Type guards and utilities
export {
  isSanitizableFileType,
  ignoredResult,
  SANITIZABLE_FILE_TYPES,
  SAFE_PNG_CHUNKS,
  PNG_METADATA_CHUNKS,
} from './types.js';

// Detection utilities
export { detectFileType, getMimeType } from './utils/detect.js';

// Individual sanitizers (for advanced use cases)
export { PngSanitizer } from './sanitizers/png.js';
export { GifSanitizer } from './sanitizers/gif.js';
export { WebpSanitizer } from './sanitizers/webp.js';
export { JpegSanitizer } from './sanitizers/jpeg.js';

// Dangerous content scanners (for scanning unsupported file types)
export {
  scanForDangerousContent,
  getScannersForType,
  Mp4Scanner,
  TiffScanner,
  PdfScanner,
  GenericScanner,
} from './scanners/index.js';

// Scanner types
export type {
  DangerousContentType,
  ScanResult,
  DangerousContentScanner,
} from './scanners/types.js';

export {
  emptyScanResult,
  dangerousScanResult,
  mergeScanResults,
} from './scanners/types.js';
