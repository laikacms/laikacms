/**
 * JPEG Sanitizer
 * 
 * Strips privacy-sensitive metadata from JPEG files using a WHITELIST approach.
 * 
 * JPEG Structure:
 * - SOI (Start of Image): 0xFFD8
 * - Segments: Each starts with 0xFF followed by marker byte
 * - EOI (End of Image): 0xFFD9
 * 
 * Metadata is stored in APP segments:
 * - APP0 (0xFFE0): JFIF - Safe, needed for display
 * - APP1 (0xFFE1): EXIF/XMP - Contains GPS, camera info, timestamps - STRIP
 * - APP2 (0xFFE2): ICC Profile - Safe, needed for color accuracy - KEEP
 * - APP3-APP11: Various - STRIP
 * - APP12 (0xFFEC): Picture Info - STRIP
 * - APP13 (0xFFED): IPTC/Photoshop - Contains location, author - STRIP
 * - APP14 (0xFFEE): Adobe - Safe, needed for color - KEEP
 * - APP15 (0xFFEF): Various - STRIP
 * - COM (0xFFFE): Comments - STRIP
 * 
 * We keep only:
 * - SOI, EOI (required)
 * - APP0 (JFIF header)
 * - APP2 (ICC profile for color accuracy)
 * - APP14 (Adobe color info)
 * - DQT, DHT, DRI, SOF*, SOS, RST*, and image data (required for display)
 */

import type { FileSanitizer, SanitizeOptions, SanitizeResult, StrippedMetadataInfo } from '../types.js';
import { CorruptedFileError } from '@laikacms/core';

// JPEG markers
const MARKER_PREFIX = 0xFF;
const SOI = 0xD8;  // Start of Image
const EOI = 0xD9;  // End of Image
const SOS = 0xDA;  // Start of Scan (image data follows)
const APP0 = 0xE0; // JFIF
const APP1 = 0xE1; // EXIF/XMP - STRIP
const APP2 = 0xE2; // ICC Profile - KEEP
const APP13 = 0xED; // IPTC - STRIP
const APP14 = 0xEE; // Adobe - KEEP
const COM = 0xFE;  // Comment - STRIP

// Markers that don't have length (standalone markers)
const STANDALONE_MARKERS = new Set([
  0xD8, // SOI
  0xD9, // EOI
  0x01, // TEM
  // RST0-RST7 (0xD0-0xD7)
  0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7,
]);

// Markers to keep (whitelist)
const SAFE_MARKERS = new Set([
  // Required markers
  0xD8, // SOI
  0xD9, // EOI
  0xDA, // SOS
  0xDB, // DQT (Quantization tables)
  0xC4, // DHT (Huffman tables)
  0xDD, // DRI (Restart interval)
  // SOF markers (Start of Frame)
  0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
  0xC8, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
  // RST markers (Restart)
  0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7,
  // APP markers we keep
  0xE0, // APP0 (JFIF)
  0xE2, // APP2 (ICC Profile)
  0xEE, // APP14 (Adobe)
]);

// Metadata markers to strip
const METADATA_MARKERS = new Set([
  0xE1, // APP1 (EXIF/XMP)
  0xE3, // APP3
  0xE4, // APP4
  0xE5, // APP5
  0xE6, // APP6
  0xE7, // APP7
  0xE8, // APP8
  0xE9, // APP9
  0xEA, // APP10
  0xEB, // APP11
  0xEC, // APP12
  0xED, // APP13 (IPTC)
  0xEF, // APP15
  0xFE, // COM (Comment)
]);

/**
 * Check if data starts with JPEG signature (SOI marker)
 */
function isJpegSignature(data: Uint8Array): boolean {
  return data.length >= 2 && 
         data[0] === MARKER_PREFIX && 
         data[1] === SOI;
}

/**
 * Read 16-bit big-endian value
 */
function readUint16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

export class JpegSanitizer implements FileSanitizer {
  readonly fileType = 'jpeg' as const;
  
  canHandle(data: Uint8Array): boolean {
    return isJpegSignature(data);
  }
  
  async sanitize(data: Uint8Array, _options: SanitizeOptions): Promise<SanitizeResult> {
    if (!isJpegSignature(data)) {
      throw new CorruptedFileError('Invalid JPEG: missing SOI marker');
    }
    
    const strippedChunks: string[] = [];
    let hadTextMetadata = false;
    let hadTimestamps = false;
    
    // Output buffer - we'll build the sanitized JPEG here
    const output: number[] = [];
    
    // Write SOI marker
    output.push(MARKER_PREFIX, SOI);
    
    let offset = 2; // Skip SOI
    
    while (offset < data.length) {
      // Find next marker
      if (data[offset] !== MARKER_PREFIX) {
        throw new CorruptedFileError(`Invalid JPEG: expected marker at offset ${offset}`);
      }
      
      // Skip padding bytes (0xFF followed by 0xFF)
      while (offset < data.length - 1 && data[offset + 1] === MARKER_PREFIX) {
        offset++;
      }
      
      if (offset >= data.length - 1) {
        throw new CorruptedFileError('Invalid JPEG: unexpected end of file');
      }
      
      const marker = data[offset + 1];
      
      // Handle EOI (End of Image)
      if (marker === EOI) {
        output.push(MARKER_PREFIX, EOI);
        break;
      }
      
      // Handle standalone markers (no length field)
      if (STANDALONE_MARKERS.has(marker)) {
        if (SAFE_MARKERS.has(marker)) {
          output.push(MARKER_PREFIX, marker);
        }
        offset += 2;
        continue;
      }
      
      // Read segment length (includes length field itself, but not marker)
      if (offset + 4 > data.length) {
        throw new CorruptedFileError('Invalid JPEG: segment length extends beyond file');
      }
      
      const segmentLength = readUint16BE(data, offset + 2);
      
      if (segmentLength < 2) {
        throw new CorruptedFileError(`Invalid JPEG: segment length too small at offset ${offset}`);
      }
      
      const segmentEnd = offset + 2 + segmentLength;
      
      if (segmentEnd > data.length) {
        throw new CorruptedFileError(`Invalid JPEG: segment extends beyond file at offset ${offset}`);
      }
      
      // Handle SOS (Start of Scan) - copy everything until EOI
      if (marker === SOS) {
        // Copy SOS marker and segment
        for (let i = offset; i < segmentEnd; i++) {
          output.push(data[i]);
        }
        
        // Copy all image data until EOI
        let scanOffset = segmentEnd;
        while (scanOffset < data.length) {
          if (data[scanOffset] === MARKER_PREFIX) {
            // Check if it's a real marker or escaped 0xFF in image data
            if (scanOffset + 1 < data.length) {
              const nextByte = data[scanOffset + 1];
              
              // 0xFF00 is escaped 0xFF in image data
              if (nextByte === 0x00) {
                output.push(data[scanOffset], data[scanOffset + 1]);
                scanOffset += 2;
                continue;
              }
              
              // RST markers can appear in scan data
              if (nextByte >= 0xD0 && nextByte <= 0xD7) {
                output.push(data[scanOffset], data[scanOffset + 1]);
                scanOffset += 2;
                continue;
              }
              
              // EOI marker - we're done
              if (nextByte === EOI) {
                output.push(MARKER_PREFIX, EOI);
                break;
              }
              
              // Any other marker - shouldn't happen in valid JPEG
              // but let's handle it gracefully
              break;
            }
          }
          
          output.push(data[scanOffset]);
          scanOffset++;
        }
        
        break; // Done processing
      }
      
      // Decide whether to keep or strip this segment
      if (SAFE_MARKERS.has(marker)) {
        // Copy the entire segment
        for (let i = offset; i < segmentEnd; i++) {
          output.push(data[i]);
        }
      } else if (METADATA_MARKERS.has(marker)) {
        // Strip this segment
        const markerName = getMarkerName(marker);
        strippedChunks.push(markerName);
        
        // Check what kind of metadata this is
        if (marker === APP1) {
          // APP1 contains EXIF (timestamps, GPS, camera info) or XMP
          hadTimestamps = true;
          hadTextMetadata = true;
        } else if (marker === APP13) {
          // APP13 contains IPTC (author, location, keywords)
          hadTextMetadata = true;
        } else if (marker === COM) {
          // Comment
          hadTextMetadata = true;
        }
      } else {
        // Unknown marker - strip it to be safe
        const markerName = getMarkerName(marker);
        strippedChunks.push(markerName);
      }
      
      offset = segmentEnd;
    }
    
    const strippedMetadata: StrippedMetadataInfo = {
      hadTextMetadata,
      hadTimestamps,
      strippedChunks: strippedChunks.length > 0 ? strippedChunks : undefined,
    };
    
    return {
      data: new Uint8Array(output),
      fileType: 'jpeg',
      strippedMetadata,
      ignored: false,
    };
  }
}

/**
 * Get human-readable marker name
 */
function getMarkerName(marker: number): string {
  if (marker >= 0xE0 && marker <= 0xEF) {
    return `APP${marker - 0xE0}`;
  }
  
  switch (marker) {
    case 0xFE: return 'COM';
    case 0xDB: return 'DQT';
    case 0xC4: return 'DHT';
    case 0xDA: return 'SOS';
    case 0xDD: return 'DRI';
    default:
      if (marker >= 0xC0 && marker <= 0xCF) {
        return `SOF${marker - 0xC0}`;
      }
      return `0x${marker.toString(16).toUpperCase().padStart(2, '0')}`;
  }
}
