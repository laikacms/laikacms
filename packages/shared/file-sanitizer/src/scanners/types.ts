/**
 * Dangerous Content Scanner Types
 * 
 * Scanners detect privacy-sensitive content in files that cannot be sanitized.
 * If dangerous content is found, the file should be rejected.
 */

import type { DetectedFileType } from '../types.js';

/**
 * Types of dangerous content that can be detected
 */
export type DangerousContentType =
  | 'gps_coordinates'      // GPS latitude/longitude
  | 'location_metadata'    // Location names, addresses
  | 'device_info'          // Camera/device identifiers
  | 'timestamp'            // Creation/modification timestamps
  | 'author_info'          // Author/creator information
  | 'facial_recognition';  // Face detection/recognition data (regions, names)

/**
 * Result of scanning for dangerous content
 */
export interface ScanResult {
  /**
   * Whether dangerous content was found
   */
  hasDangerousContent: boolean;
  
  /**
   * Types of dangerous content found
   */
  foundTypes: DangerousContentType[];
  
  /**
   * Human-readable descriptions of what was found
   */
  details: string[];
}

/**
 * Interface for file type specific scanners
 */
export interface DangerousContentScanner {
  /**
   * File types this scanner can handle
   */
  readonly supportedTypes: readonly DetectedFileType[];
  
  /**
   * Check if this scanner can handle the given file type
   */
  canHandle(fileType: DetectedFileType): boolean;
  
  /**
   * Scan the file for dangerous content
   */
  scan(data: Uint8Array, fileType: DetectedFileType): ScanResult;
}

/**
 * Create an empty scan result (no dangerous content found)
 */
export function emptyScanResult(): ScanResult {
  return {
    hasDangerousContent: false,
    foundTypes: [],
    details: [],
  };
}

/**
 * Create a scan result with dangerous content
 */
export function dangerousScanResult(
  types: DangerousContentType[],
  details: string[]
): ScanResult {
  return {
    hasDangerousContent: true,
    foundTypes: types,
    details,
  };
}

/**
 * Merge multiple scan results
 */
export function mergeScanResults(...results: ScanResult[]): ScanResult {
  const foundTypes: DangerousContentType[] = [];
  const details: string[] = [];
  
  for (const result of results) {
    for (const type of result.foundTypes) {
      if (!foundTypes.includes(type)) {
        foundTypes.push(type);
      }
    }
    details.push(...result.details);
  }
  
  return {
    hasDangerousContent: foundTypes.length > 0,
    foundTypes,
    details,
  };
}
