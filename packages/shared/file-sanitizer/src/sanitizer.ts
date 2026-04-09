/**
 * Main file sanitizer
 *
 * Orchestrates file type detection and sanitization.
 * Uses a WHITELIST approach - only explicitly supported file types are processed.
 * Unknown or unsupported files throw errors (unless in ignoreExtensions list).
 *
 * For unsupported file types, dangerous content scanning is performed to detect
 * privacy-sensitive metadata (GPS coordinates, facial recognition data) before
 * rejecting the file.
 */

import { DangerousFileTypeError, FileTooLargeError, UnsupportedFileTypeError } from '@laikacms/core';
import { GifSanitizer } from './sanitizers/gif.js';
import { JpegSanitizer } from './sanitizers/jpeg.js';
import { PngSanitizer } from './sanitizers/png.js';
import { WebpSanitizer } from './sanitizers/webp.js';
import { scanForDangerousContent } from './scanners/index.js';
import type { DetectedFileType, SanitizeOptions, SanitizeResult } from './types.js';
import { ignoredResult, isSanitizableFileType } from './types.js';
import { detectFileType, getMimeType } from './utils/detect.js';

// Initialize sanitizers
const pngSanitizer = new PngSanitizer();
const gifSanitizer = new GifSanitizer();
const webpSanitizer = new WebpSanitizer();
const jpegSanitizer = new JpegSanitizer();

/**
 * Default options for sanitization
 */
const DEFAULT_OPTIONS: Required<SanitizeOptions> = {
  maxFileSize: 100 * 1024 * 1024, // 100MB
  ignoreExtensions: [],
};

/**
 * Normalize file extension (lowercase, no leading dot)
 */
function normalizeExtension(ext: string): string {
  return ext.toLowerCase().replace(/^\./, '');
}

/**
 * Check if a detected type should be ignored
 */
function shouldIgnore(detectedType: DetectedFileType, ignoreList: string[]): boolean {
  return ignoreList.some(ext => normalizeExtension(ext) === detectedType);
}

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
export async function sanitizeFile(
  data: Uint8Array,
  options: SanitizeOptions = {},
  expectedMimeType?: string,
): Promise<SanitizeResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check file size
  if (data.length > opts.maxFileSize) {
    throw new FileTooLargeError(
      `File size ${data.length} bytes exceeds maximum ${opts.maxFileSize} bytes`,
    );
  }

  // Detect file type from magic bytes
  const detectedType = detectFileType(data);

  // Check if this type should be ignored
  if (shouldIgnore(detectedType, opts.ignoreExtensions)) {
    return ignoredResult(data);
  }

  // Check for MIME type mismatch if expected type provided
  if (expectedMimeType) {
    const detectedMimeType = getMimeType(detectedType);
    if (!mimeTypesMatch(expectedMimeType, detectedMimeType, detectedType)) {
      throw new UnsupportedFileTypeError(
        `Expected MIME type ${expectedMimeType} but detected ${detectedMimeType} (${detectedType})`,
      );
    }
  }

  // Check if file type is in our whitelist
  if (!isSanitizableFileType(detectedType)) {
    // For unsupported types, scan for dangerous content before rejecting
    const scanResult = scanForDangerousContent(data, detectedType);

    if (scanResult.hasDangerousContent) {
      // File contains dangerous content - throw a more specific error
      const dangerousTypes = scanResult.foundTypes.join(', ');
      const details = scanResult.details.slice(0, 3).join('; '); // Limit details
      throw new DangerousFileTypeError(
        `File type '${detectedType}' contains dangerous metadata (${dangerousTypes}): ${details}. `
          + `This file type cannot be sanitized and contains privacy-sensitive data.`,
      );
    }

    // No dangerous content found, but still unsupported
    throw new UnsupportedFileTypeError(
      `File type '${detectedType}' is not supported. Only PNG, GIF, WebP, and JPEG files can be sanitized.`,
    );
  }

  // Dispatch to appropriate sanitizer
  switch (detectedType) {
    case 'png':
      return pngSanitizer.sanitize(data, opts);
    case 'gif':
      return gifSanitizer.sanitize(data, opts);
    case 'webp':
      return webpSanitizer.sanitize(data, opts);
    case 'jpeg':
      return jpegSanitizer.sanitize(data, opts);
    default:
      // TypeScript should catch this, but just in case
      throw new UnsupportedFileTypeError(
        `No sanitizer available for file type '${detectedType}'`,
      );
  }
}

/**
 * Check if two MIME types match (with some flexibility)
 */
function mimeTypesMatch(
  expected: string,
  detected: string,
  detectedType: DetectedFileType,
): boolean {
  // Normalize MIME types
  const normalizedExpected = expected.toLowerCase().split(';')[0].trim();
  const normalizedDetected = detected.toLowerCase();

  // Exact match
  if (normalizedExpected === normalizedDetected) {
    return true;
  }

  // Handle common variations
  const variations: Record<string, string[]> = {
    'image/jpeg': ['image/jpg'],
    'image/jpg': ['image/jpeg'],
    'image/png': [],
    'image/gif': [],
    'image/webp': [],
  };

  const expectedVariations = variations[normalizedExpected] || [];
  if (expectedVariations.includes(normalizedDetected)) {
    return true;
  }

  // If detected type is unknown but expected is a supported type, reject
  // (the file doesn't match what it claims to be)
  if (detectedType === 'unknown') {
    return false;
  }

  return false;
}

/**
 * Check if a file can be sanitized (without actually sanitizing it)
 * Useful for validation before upload
 */
export function canSanitize(data: Uint8Array): {
  canSanitize: boolean,
  detectedType: DetectedFileType,
  reason?: string,
} {
  const detectedType = detectFileType(data);

  if (!isSanitizableFileType(detectedType)) {
    return {
      canSanitize: false,
      detectedType,
      reason: `File type '${detectedType}' is not supported. Only PNG, GIF, WebP, and JPEG files can be sanitized.`,
    };
  }

  return {
    canSanitize: true,
    detectedType,
  };
}

/**
 * Get a list of supported file types
 */
export function getSupportedFileTypes(): readonly string[] {
  return ['png', 'gif', 'webp', 'jpeg'] as const;
}
