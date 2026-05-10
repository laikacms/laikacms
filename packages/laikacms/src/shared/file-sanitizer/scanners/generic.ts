/**
 * Generic Dangerous Content Scanner
 *
 * Scans any file type for common privacy-sensitive patterns.
 * This is a fallback scanner for file types without specific scanners.
 *
 * It looks for:
 * - XMP metadata (common across many formats)
 * - GPS coordinate patterns in text
 * - Face recognition metadata patterns
 */

import type { DetectedFileType } from '../types.js';
import type { DangerousContentScanner, DangerousContentType, ScanResult } from './types.js';
import { dangerousScanResult, emptyScanResult, mergeScanResults } from './types.js';

/**
 * XMP patterns for GPS
 */
const XMP_GPS_PATTERNS = [
  'GPSLatitude',
  'GPSLongitude',
  'GPSAltitude',
  'GPSCoordinates',
  'exif:GPSLatitude',
  'exif:GPSLongitude',
  'photoshop:City',
  'photoshop:Country',
  'Iptc4xmpCore:Location',
];

/**
 * Face recognition patterns
 */
const FACE_RECOGNITION_PATTERNS = [
  'mwg-rs:Regions',
  'mwg-rs:RegionList',
  'mwg-rs:Name',
  'MP:RegionInfo',
  'MPReg:PersonDisplayName',
  'xmpDM:faceRegion',
  'FaceRegion',
  'PersonInImage',
];

/**
 * Decode bytes to string
 */
function bytesToString(data: Uint8Array): string {
  let result = '';
  for (let i = 0; i < data.length; i++) {
    result += String.fromCharCode(data[i]);
  }
  return result;
}

export class GenericScanner implements DangerousContentScanner {
  // This scanner can handle any file type as a fallback
  // Only list types that are actually defined in DetectedFileType
  readonly supportedTypes: readonly DetectedFileType[] = [
    'unknown',
    'mp4',
    'mov',
    'avi',
    'tiff',
    'heic',
    'heif',
    'pdf',
  ];

  canHandle(_fileType: DetectedFileType): boolean {
    // Generic scanner can handle any file type
    return true;
  }

  scan(data: Uint8Array, _fileType: DetectedFileType): ScanResult {
    const results: ScanResult[] = [];

    // Scan for XMP metadata
    results.push(this.scanForXmpMetadata(data));

    return mergeScanResults(...results);
  }

  /**
   * Scan for XMP metadata containing GPS and face recognition information
   */
  private scanForXmpMetadata(data: Uint8Array): ScanResult {
    // Look for XMP packet markers
    const xmpStart = this.findSequence(data, [0x3C, 0x3F, 0x78, 0x70, 0x61, 0x63, 0x6B, 0x65, 0x74]); // <?xpacket

    if (xmpStart === -1) {
      // Also try looking for x:xmpmeta
      const xmpMetaStart = this.findSequence(data, [0x78, 0x3A, 0x78, 0x6D, 0x70, 0x6D, 0x65, 0x74, 0x61]); // x:xmpmeta
      if (xmpMetaStart === -1) {
        // Try looking for rdf:RDF (common in XMP)
        const rdfStart = this.findSequence(data, [0x72, 0x64, 0x66, 0x3A, 0x52, 0x44, 0x46]); // rdf:RDF
        if (rdfStart === -1) {
          return emptyScanResult();
        }
        return this.scanXmpContent(data, Math.max(0, rdfStart - 100));
      }
      return this.scanXmpContent(data, xmpMetaStart);
    }

    return this.scanXmpContent(data, xmpStart);
  }

  /**
   * Scan XMP content for dangerous patterns
   */
  private scanXmpContent(data: Uint8Array, startOffset: number): ScanResult {
    // Find the end of XMP (look for closing tag or end marker)
    let endOffset = this.findSequence(data, [
      0x3C,
      0x3F,
      0x78,
      0x70,
      0x61,
      0x63,
      0x6B,
      0x65,
      0x74,
      0x20,
      0x65,
      0x6E,
      0x64,
    ], startOffset); // <?xpacket end

    if (endOffset === -1) {
      // Try to find </x:xmpmeta>
      endOffset = this.findSequence(
        data,
        [0x3C, 0x2F, 0x78, 0x3A, 0x78, 0x6D, 0x70, 0x6D, 0x65, 0x74, 0x61],
        startOffset,
      );
    }

    if (endOffset === -1) {
      // Try to find </rdf:RDF>
      endOffset = this.findSequence(data, [0x3C, 0x2F, 0x72, 0x64, 0x66, 0x3A, 0x52, 0x44, 0x46], startOffset);
    }

    if (endOffset === -1) {
      // Limit search to 100KB from start
      endOffset = Math.min(startOffset + 100000, data.length);
    }

    // Extract XMP as string
    const xmpData = data.slice(startOffset, Math.min(endOffset + 50, data.length));
    const xmpString = bytesToString(xmpData);

    const foundTypes: DangerousContentType[] = [];
    const details: string[] = [];

    // Check for GPS patterns
    for (const pattern of XMP_GPS_PATTERNS) {
      if (xmpString.includes(pattern)) {
        if (!foundTypes.includes('gps_coordinates')) {
          foundTypes.push('gps_coordinates');
        }
        if (!foundTypes.includes('location_metadata')) {
          foundTypes.push('location_metadata');
        }
        details.push(`Found XMP GPS metadata: ${pattern}`);
      }
    }

    // Check for face recognition patterns
    for (const pattern of FACE_RECOGNITION_PATTERNS) {
      if (xmpString.includes(pattern)) {
        if (!foundTypes.includes('facial_recognition')) {
          foundTypes.push('facial_recognition');
        }
        details.push(`Found face recognition metadata: ${pattern}`);
      }
    }

    if (foundTypes.length > 0) {
      return dangerousScanResult(foundTypes, details);
    }

    return emptyScanResult();
  }

  /**
   * Find a byte sequence in data
   */
  private findSequence(data: Uint8Array, sequence: number[], startOffset = 0): number {
    // Limit search to first 10MB to avoid performance issues
    const maxSearch = Math.min(data.length, 10 * 1024 * 1024);

    outer: for (let i = startOffset; i <= maxSearch - sequence.length; i++) {
      for (let j = 0; j < sequence.length; j++) {
        if (data[i + j] !== sequence[j]) {
          continue outer;
        }
      }
      return i;
    }
    return -1;
  }
}
