/**
 * File type detection based on magic bytes
 * 
 * Only detects file types that we can sanitize or that we want to give
 * specific error messages for. Everything else returns 'unknown'.
 */

import type { DetectedFileType } from '../types.js';
import { startsWith, readUint32BE } from './binary.js';

/**
 * Magic bytes for different file types
 */
const MAGIC_BYTES = {
  // JPEG: FFD8FF
  JPEG: [0xFF, 0xD8, 0xFF],
  
  // PNG: 89504E470D0A1A0A
  PNG: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  
  // GIF: GIF87a or GIF89a
  GIF87: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  GIF89: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  
  // WebP: RIFF....WEBP
  RIFF: [0x52, 0x49, 0x46, 0x46],
  WEBP: [0x57, 0x45, 0x42, 0x50],
  
  // TIFF: II (little-endian) or MM (big-endian)
  TIFF_LE: [0x49, 0x49, 0x2A, 0x00],
  TIFF_BE: [0x4D, 0x4D, 0x00, 0x2A],
  
  // HEIC/HEIF: ftyp box with heic, heix, hevc, hevx, mif1, msf1
  FTYP: [0x66, 0x74, 0x79, 0x70], // 'ftyp' at offset 4
  
  // AVI: RIFF....AVI
  AVI: [0x41, 0x56, 0x49, 0x20],
  
  // PDF: %PDF
  PDF: [0x25, 0x50, 0x44, 0x46],
} as const;

/**
 * HEIC/HEIF brand identifiers
 */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

/**
 * MOV brand identifiers
 */
const MOV_BRANDS = ['qt  ', 'mqt '];

/**
 * MP4 brand identifiers
 */
const MP4_BRANDS = ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp71', 'avc1', 'M4V ', 'M4A ', 'f4v ', 'kddi', 'M4VP', 'MSNV', 'NDAS', 'NDSC', 'NDSH', 'NDSM', 'NDSP', 'NDSS', 'NDXC', 'NDXH', 'NDXM', 'NDXP', 'NDXS'];

/**
 * Detect file type from magic bytes
 * 
 * Returns the detected type for:
 * - Sanitizable types: png, gif, webp
 * - Common unsupported types: jpeg, tiff, heic, heif, mp4, mov, avi, pdf
 * - Everything else: 'unknown'
 */
export function detectFileType(data: Uint8Array): DetectedFileType {
  if (data.length < 12) {
    return 'unknown';
  }
  
  // PNG (sanitizable)
  if (startsWith(data, MAGIC_BYTES.PNG)) {
    return 'png';
  }
  
  // GIF (sanitizable)
  if (startsWith(data, MAGIC_BYTES.GIF87) || startsWith(data, MAGIC_BYTES.GIF89)) {
    return 'gif';
  }
  
  // RIFF-based formats (WebP is sanitizable, AVI is not)
  if (startsWith(data, MAGIC_BYTES.RIFF)) {
    // Check for WebP at offset 8
    if (data[8] === MAGIC_BYTES.WEBP[0] &&
        data[9] === MAGIC_BYTES.WEBP[1] &&
        data[10] === MAGIC_BYTES.WEBP[2] &&
        data[11] === MAGIC_BYTES.WEBP[3]) {
      return 'webp';
    }
    // Check for AVI at offset 8
    if (data[8] === MAGIC_BYTES.AVI[0] &&
        data[9] === MAGIC_BYTES.AVI[1] &&
        data[10] === MAGIC_BYTES.AVI[2] &&
        data[11] === MAGIC_BYTES.AVI[3]) {
      return 'avi';
    }
    // Unknown RIFF format
    return 'unknown';
  }
  
  // JPEG (common but not sanitizable)
  if (startsWith(data, MAGIC_BYTES.JPEG)) {
    return 'jpeg';
  }
  
  // TIFF (common but not sanitizable)
  if (startsWith(data, MAGIC_BYTES.TIFF_LE) || startsWith(data, MAGIC_BYTES.TIFF_BE)) {
    return 'tiff';
  }
  
  // PDF (common but not sanitizable)
  if (startsWith(data, MAGIC_BYTES.PDF)) {
    return 'pdf';
  }
  
  // ISO Base Media File Format (HEIC, MP4, MOV)
  // Check for ftyp box
  if (data[4] === MAGIC_BYTES.FTYP[0] &&
      data[5] === MAGIC_BYTES.FTYP[1] &&
      data[6] === MAGIC_BYTES.FTYP[2] &&
      data[7] === MAGIC_BYTES.FTYP[3]) {
    // Read the brand (4 bytes after 'ftyp')
    const brand = String.fromCharCode(data[8], data[9], data[10], data[11]);
    
    if (HEIC_BRANDS.includes(brand)) {
      return 'heic';
    }
    
    if (MOV_BRANDS.includes(brand)) {
      return 'mov';
    }
    
    if (MP4_BRANDS.includes(brand)) {
      return 'mp4';
    }
    
    // Check compatible brands in the ftyp box
    const boxSize = readUint32BE(data, 0);
    if (boxSize > 16 && boxSize <= data.length) {
      // Compatible brands start at offset 16
      for (let i = 16; i < boxSize - 3; i += 4) {
        const compatBrand = String.fromCharCode(data[i], data[i + 1], data[i + 2], data[i + 3]);
        
        if (HEIC_BRANDS.includes(compatBrand)) {
          return 'heic';
        }
        if (MOV_BRANDS.includes(compatBrand)) {
          return 'mov';
        }
        if (MP4_BRANDS.includes(compatBrand)) {
          return 'mp4';
        }
      }
    }
    
    // Default to mp4 for unknown ISO base media
    return 'mp4';
  }
  
  // Everything else is unknown
  return 'unknown';
}

/**
 * Get MIME type for file type
 */
export function getMimeType(type: DetectedFileType): string {
  switch (type) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'jpeg':
      return 'image/jpeg';
    case 'tiff':
      return 'image/tiff';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}
