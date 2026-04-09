/**
 * MP4/MOV Dangerous Content Scanner
 *
 * Scans MP4 and MOV files for privacy-sensitive metadata.
 *
 * MP4/MOV Structure (ISO Base Media File Format):
 * - Files are composed of "boxes" (also called "atoms")
 * - Each box has: 4-byte size, 4-byte type, then data
 * - Metadata is typically in: moov > udta > meta > ilst
 * - GPS data can be in:
 *   - ©xyz (GPS coordinates as string)
 *   - GPS  (GPS data)
 *   - XMP metadata (embedded XML with GPS)
 *
 * We scan for:
 * - GPS coordinate boxes (©xyz, GPS)
 * - XMP metadata containing GPS tags
 * - Location-related metadata
 */

import type { DetectedFileType } from '../types.js';
import { readUint32BE } from '../utils/binary.js';
import type { DangerousContentScanner, ScanResult } from './types.js';
import { dangerousScanResult, emptyScanResult, mergeScanResults } from './types.js';

/**
 * Box types that may contain GPS/location data
 */
const GPS_BOX_TYPES = [
  '©xyz', // GPS coordinates (common in iPhone videos)
  'GPS ', // GPS data
  '©loc', // Location
  'loci', // Location information
];

/**
 * XMP GPS-related tags to search for
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
 * Facial recognition related patterns
 */
const FACE_RECOGNITION_PATTERNS = [
  'mwg-rs:Regions', // Metadata Working Group face regions
  'mwg-rs:RegionList', // Face region list
  'mwg-rs:Name', // Person name in face region
  'MP:RegionInfo', // Microsoft Photo face regions
  'MPReg:PersonDisplayName', // Microsoft face name
  'xmpDM:faceRegion', // XMP face region
  'apple:FaceInfo', // Apple face info
  'FaceRegion', // Generic face region
  'PersonInImage', // Person identification
];

/**
 * Decode bytes to string (works in both Node.js and browser)
 */
function bytesToString(data: Uint8Array): string {
  let result = '';
  for (let i = 0; i < data.length; i++) {
    result += String.fromCharCode(data[i]);
  }
  return result;
}

export class Mp4Scanner implements DangerousContentScanner {
  readonly supportedTypes: readonly DetectedFileType[] = ['mp4', 'mov'];

  canHandle(fileType: DetectedFileType): boolean {
    return this.supportedTypes.includes(fileType);
  }

  scan(data: Uint8Array, _fileType: DetectedFileType): ScanResult {
    const results: ScanResult[] = [];

    // Scan for GPS boxes
    results.push(this.scanForGpsBoxes(data));

    // Scan for XMP metadata with GPS and face data
    results.push(this.scanForXmpMetadata(data));

    return mergeScanResults(...results);
  }

  /**
   * Scan for GPS-related boxes in the MP4 structure
   */
  private scanForGpsBoxes(data: Uint8Array): ScanResult {
    const foundTypes: string[] = [];
    const details: string[] = [];

    let offset = 0;

    while (offset < data.length - 8) {
      // Read box size and type
      const size = readUint32BE(data, offset);

      if (size < 8 || offset + size > data.length) {
        // Invalid box, try to continue
        offset += 4;
        continue;
      }

      const type = String.fromCharCode(
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
      );

      // Check if this is a GPS-related box
      if (GPS_BOX_TYPES.includes(type)) {
        foundTypes.push(type);
        details.push(`Found GPS metadata box: ${type}`);
      }

      // Recursively scan container boxes
      if (type === 'moov' || type === 'udta' || type === 'meta' || type === 'ilst') {
        // These are container boxes, scan their contents
        const innerResult = this.scanForGpsBoxes(
          data.slice(offset + 8, offset + size),
        );
        if (innerResult.hasDangerousContent) {
          foundTypes.push(...innerResult.details.map(() => type));
          details.push(...innerResult.details);
        }
      }

      offset += size;
    }

    if (foundTypes.length > 0) {
      return dangerousScanResult(['gps_coordinates'], details);
    }

    return emptyScanResult();
  }

  /**
   * Scan for XMP metadata containing GPS and face recognition information
   */
  private scanForXmpMetadata(data: Uint8Array): ScanResult {
    // Look for XMP packet markers
    const xmpStart = this.findSequence(data, [0x3C, 0x3F, 0x78, 0x70, 0x61, 0x63, 0x6B, 0x65, 0x74]); // <?xpacket

    if (xmpStart === -1) {
      return emptyScanResult();
    }

    // Find the end of XMP
    const xmpEnd = this.findSequence(data, [
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
    ], xmpStart); // <?xpacket end

    if (xmpEnd === -1) {
      return emptyScanResult();
    }

    // Extract XMP as string
    const xmpData = data.slice(xmpStart, Math.min(xmpEnd + 50, data.length));
    const xmpString = bytesToString(xmpData);

    const foundTypes: ('gps_coordinates' | 'location_metadata' | 'facial_recognition')[] = [];
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
