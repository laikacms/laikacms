/**
 * Dangerous Content Scanners
 * 
 * Scanners detect privacy-sensitive content in files that cannot be sanitized.
 * If dangerous content is found, the file should be rejected.
 */

export * from './types.js';
export { Mp4Scanner } from './mp4.js';
export { TiffScanner } from './tiff.js';
export { PdfScanner } from './pdf.js';
export { GenericScanner } from './generic.js';

import type { DetectedFileType } from '../types.js';
import type { DangerousContentScanner, ScanResult } from './types.js';
import { emptyScanResult, mergeScanResults } from './types.js';
import { Mp4Scanner } from './mp4.js';
import { TiffScanner } from './tiff.js';
import { PdfScanner } from './pdf.js';
import { GenericScanner } from './generic.js';

/**
 * All available scanners
 */
const scanners: DangerousContentScanner[] = [
  new Mp4Scanner(),
  new TiffScanner(),
  new PdfScanner(),
  new GenericScanner(),
];

/**
 * Scan a file for dangerous content using all applicable scanners
 */
export function scanForDangerousContent(
  data: Uint8Array,
  fileType: DetectedFileType
): ScanResult {
  const results: ScanResult[] = [];
  
  for (const scanner of scanners) {
    if (scanner.canHandle(fileType)) {
      results.push(scanner.scan(data, fileType));
    }
  }
  
  if (results.length === 0) {
    return emptyScanResult();
  }
  
  return mergeScanResults(...results);
}

/**
 * Get all scanners that can handle a specific file type
 */
export function getScannersForType(fileType: DetectedFileType): DangerousContentScanner[] {
  return scanners.filter(scanner => scanner.canHandle(fileType));
}
