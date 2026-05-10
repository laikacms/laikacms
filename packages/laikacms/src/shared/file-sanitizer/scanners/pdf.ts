/**
 * PDF Dangerous Content Scanner
 *
 * Scans PDF files for privacy-sensitive metadata.
 *
 * PDF Structure:
 * - Header: %PDF-x.x
 * - Objects: contain document data
 * - XMP metadata: embedded XML with GPS/face data
 * - Document Info dictionary: author, creation date, etc.
 *
 * GPS data can be in:
 * - XMP metadata stream
 * - Custom metadata fields
 *
 * Face recognition data can be in:
 * - XMP metadata (MWG regions)
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
  'photoshop:State',
  'Iptc4xmpCore:Location',
  'dc:coverage', // Dublin Core coverage (can contain location)
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
 * PDF metadata patterns that might contain location
 */
const PDF_LOCATION_PATTERNS = [
  '/Location',
  '/GeoLocation',
  '/GPS',
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

export class PdfScanner implements DangerousContentScanner {
  readonly supportedTypes: readonly DetectedFileType[] = ['pdf'];

  canHandle(fileType: DetectedFileType): boolean {
    return this.supportedTypes.includes(fileType);
  }

  scan(data: Uint8Array, _fileType: DetectedFileType): ScanResult {
    const results: ScanResult[] = [];

    // Scan for XMP metadata
    results.push(this.scanForXmpMetadata(data));

    // Scan for PDF-specific location metadata
    results.push(this.scanForPdfLocationMetadata(data));

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
        return emptyScanResult();
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
   * Scan for PDF-specific location metadata
   */
  private scanForPdfLocationMetadata(data: Uint8Array): ScanResult {
    // Convert to string for pattern matching (limit to first 1MB)
    const searchData = data.slice(0, Math.min(data.length, 1024 * 1024));
    const pdfString = bytesToString(searchData);

    const foundTypes: DangerousContentType[] = [];
    const details: string[] = [];

    for (const pattern of PDF_LOCATION_PATTERNS) {
      if (pdfString.includes(pattern)) {
        if (!foundTypes.includes('location_metadata')) {
          foundTypes.push('location_metadata');
        }
        details.push(`Found PDF location metadata: ${pattern}`);
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
    outer: for (let i = startOffset; i <= data.length - sequence.length; i++) {
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
