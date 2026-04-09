/**
 * TIFF Dangerous Content Scanner
 *
 * Scans TIFF files for privacy-sensitive metadata.
 *
 * TIFF Structure:
 * - Header: 8 bytes (byte order + magic + IFD offset)
 * - IFD (Image File Directory): contains tags
 * - EXIF IFD: contains camera/GPS metadata
 *
 * GPS data is stored in:
 * - GPS IFD (tag 0x8825 points to it)
 * - Tags: GPSLatitude (0x0002), GPSLongitude (0x0004), etc.
 *
 * Face recognition data can be in:
 * - XMP metadata (tag 0x02BC)
 * - IPTC metadata (tag 0x83BB)
 */

import type { DetectedFileType } from '../types.js';
import { readUint16BE, readUint16LE, readUint32BE, readUint32LE } from '../utils/binary.js';
import type { DangerousContentScanner, DangerousContentType, ScanResult } from './types.js';
import { dangerousScanResult, emptyScanResult, mergeScanResults } from './types.js';

/**
 * TIFF tag IDs for GPS and face data
 */
const TIFF_TAGS = {
  GPS_IFD_POINTER: 0x8825, // Pointer to GPS IFD
  XMP: 0x02BC, // XMP metadata
  IPTC: 0x83BB, // IPTC metadata
  EXIF_IFD_POINTER: 0x8769, // Pointer to EXIF IFD
};

/**
 * GPS IFD tag IDs
 */
const GPS_TAGS = {
  GPS_LATITUDE_REF: 0x0001,
  GPS_LATITUDE: 0x0002,
  GPS_LONGITUDE_REF: 0x0003,
  GPS_LONGITUDE: 0x0004,
  GPS_ALTITUDE_REF: 0x0005,
  GPS_ALTITUDE: 0x0006,
  GPS_TIMESTAMP: 0x0007,
  GPS_SATELLITES: 0x0008,
  GPS_STATUS: 0x0009,
  GPS_MEASURE_MODE: 0x000A,
  GPS_DOP: 0x000B,
  GPS_SPEED_REF: 0x000C,
  GPS_SPEED: 0x000D,
  GPS_TRACK_REF: 0x000E,
  GPS_TRACK: 0x000F,
  GPS_IMG_DIRECTION_REF: 0x0010,
  GPS_IMG_DIRECTION: 0x0011,
  GPS_MAP_DATUM: 0x0012,
  GPS_DEST_LATITUDE_REF: 0x0013,
  GPS_DEST_LATITUDE: 0x0014,
  GPS_DEST_LONGITUDE_REF: 0x0015,
  GPS_DEST_LONGITUDE: 0x0016,
  GPS_DEST_BEARING_REF: 0x0017,
  GPS_DEST_BEARING: 0x0018,
  GPS_DEST_DISTANCE_REF: 0x0019,
  GPS_DEST_DISTANCE: 0x001A,
  GPS_PROCESSING_METHOD: 0x001B,
  GPS_AREA_INFORMATION: 0x001C,
  GPS_DATE_STAMP: 0x001D,
  GPS_DIFFERENTIAL: 0x001E,
};

/**
 * XMP patterns for GPS and face recognition
 */
const XMP_GPS_PATTERNS = [
  'GPSLatitude',
  'GPSLongitude',
  'GPSAltitude',
  'exif:GPSLatitude',
  'exif:GPSLongitude',
  'photoshop:City',
  'photoshop:Country',
  'Iptc4xmpCore:Location',
];

const FACE_RECOGNITION_PATTERNS = [
  'mwg-rs:Regions',
  'mwg-rs:RegionList',
  'mwg-rs:Name',
  'MP:RegionInfo',
  'MPReg:PersonDisplayName',
  'xmpDM:faceRegion',
  'apple:FaceInfo',
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

export class TiffScanner implements DangerousContentScanner {
  readonly supportedTypes: readonly DetectedFileType[] = ['tiff'];

  canHandle(fileType: DetectedFileType): boolean {
    return this.supportedTypes.includes(fileType);
  }

  scan(data: Uint8Array, _fileType: DetectedFileType): ScanResult {
    if (data.length < 8) {
      return emptyScanResult();
    }

    // Determine byte order
    const isLittleEndian = data[0] === 0x49 && data[1] === 0x49; // 'II'
    const isBigEndian = data[0] === 0x4D && data[1] === 0x4D; // 'MM'

    if (!isLittleEndian && !isBigEndian) {
      return emptyScanResult();
    }

    const readUint16 = isLittleEndian ? readUint16LE : readUint16BE;
    const readUint32 = isLittleEndian ? readUint32LE : readUint32BE;

    // Verify magic number (42)
    const magic = readUint16(data, 2);
    if (magic !== 42) {
      return emptyScanResult();
    }

    // Get first IFD offset
    const ifdOffset = readUint32(data, 4);

    const results: ScanResult[] = [];

    // Scan IFD for GPS and XMP
    results.push(this.scanIFD(data, ifdOffset, readUint16, readUint32));

    return mergeScanResults(...results);
  }

  /**
   * Scan an IFD for GPS and metadata tags
   */
  private scanIFD(
    data: Uint8Array,
    offset: number,
    readUint16: (data: Uint8Array, offset: number) => number,
    readUint32: (data: Uint8Array, offset: number) => number,
  ): ScanResult {
    if (offset + 2 > data.length) {
      return emptyScanResult();
    }

    const numEntries = readUint16(data, offset);
    const results: ScanResult[] = [];

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = offset + 2 + (i * 12);

      if (entryOffset + 12 > data.length) {
        break;
      }

      const tag = readUint16(data, entryOffset);
      const type = readUint16(data, entryOffset + 2);
      const count = readUint32(data, entryOffset + 4);
      const valueOffset = readUint32(data, entryOffset + 8);

      // Check for GPS IFD pointer
      if (tag === TIFF_TAGS.GPS_IFD_POINTER) {
        results.push(this.scanGpsIFD(data, valueOffset, readUint16, readUint32));
      }

      // Check for XMP metadata
      if (tag === TIFF_TAGS.XMP) {
        const xmpSize = this.getValueSize(type) * count;
        if (valueOffset + xmpSize <= data.length) {
          const xmpData = data.slice(valueOffset, valueOffset + Math.min(xmpSize, 100000));
          results.push(this.scanXmpData(xmpData));
        }
      }

      // Check for EXIF IFD (may contain GPS pointer)
      if (tag === TIFF_TAGS.EXIF_IFD_POINTER) {
        results.push(this.scanIFD(data, valueOffset, readUint16, readUint32));
      }
    }

    return mergeScanResults(...results);
  }

  /**
   * Scan GPS IFD for location data
   */
  private scanGpsIFD(
    data: Uint8Array,
    offset: number,
    readUint16: (data: Uint8Array, offset: number) => number,
    _readUint32: (data: Uint8Array, offset: number) => number,
  ): ScanResult {
    if (offset + 2 > data.length) {
      return emptyScanResult();
    }

    const numEntries = readUint16(data, offset);
    const foundTags: string[] = [];
    const details: string[] = [];

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = offset + 2 + (i * 12);

      if (entryOffset + 12 > data.length) {
        break;
      }

      const tag = readUint16(data, entryOffset);

      // Check for GPS coordinate tags
      if (tag === GPS_TAGS.GPS_LATITUDE || tag === GPS_TAGS.GPS_LONGITUDE) {
        foundTags.push(tag === GPS_TAGS.GPS_LATITUDE ? 'GPSLatitude' : 'GPSLongitude');
        details.push(`Found GPS tag: ${tag === GPS_TAGS.GPS_LATITUDE ? 'Latitude' : 'Longitude'}`);
      }

      // Check for other location-related tags
      if (tag === GPS_TAGS.GPS_ALTITUDE) {
        foundTags.push('GPSAltitude');
        details.push('Found GPS tag: Altitude');
      }
    }

    if (foundTags.length > 0) {
      return dangerousScanResult(['gps_coordinates', 'location_metadata'], details);
    }

    return emptyScanResult();
  }

  /**
   * Scan XMP data for GPS and face recognition patterns
   */
  private scanXmpData(xmpData: Uint8Array): ScanResult {
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
   * Get the size in bytes for a TIFF type
   */
  private getValueSize(type: number): number {
    switch (type) {
      case 1:
        return 1; // BYTE
      case 2:
        return 1; // ASCII
      case 3:
        return 2; // SHORT
      case 4:
        return 4; // LONG
      case 5:
        return 8; // RATIONAL
      case 6:
        return 1; // SBYTE
      case 7:
        return 1; // UNDEFINED
      case 8:
        return 2; // SSHORT
      case 9:
        return 4; // SLONG
      case 10:
        return 8; // SRATIONAL
      case 11:
        return 4; // FLOAT
      case 12:
        return 8; // DOUBLE
      default:
        return 1;
    }
  }
}
