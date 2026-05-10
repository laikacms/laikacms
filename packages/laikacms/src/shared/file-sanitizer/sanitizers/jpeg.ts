/**
 * JPEG Sanitizer
 *
 * Strips privacy-sensitive metadata from JPEG files using a BLOCKLIST approach.
 *
 * JPEG Structure:
 * - SOI (Start of Image): 0xFFD8
 * - Segments: Each starts with 0xFF followed by marker byte
 * - EOI (End of Image): 0xFFD9
 *
 * Stripping rules:
 * - APP1 (0xFFE1): EXIF/XMP — always stripped (privacy-sensitive by nature)
 * - APP13 (0xFFED): IPTC/Photoshop — always stripped (location, author)
 * - COM (0xFFFE): Comments — payload is scanned; only stripped when it
 *   contains GPS / location / face-recognition patterns. Benign comments
 *   (tool signatures, captions) are preserved.
 *
 * The walker only inspects segments before the first SOS marker — that's
 * where APPn / COM segments live. Once entropy-coded scan data starts, the
 * rest of the file (including any progressive scans, DHT/DQT segments
 * between scans, DNL, and EOI) is copied through verbatim. Re-parsing scan
 * data is what was truncating progressive JPEGs in the previous version.
 *
 * If no dangerous segments are found, the original Uint8Array is returned
 * unchanged — the bytes are not even copied.
 */

import { CorruptedFileError } from '@laikacms/core';
import type { FileSanitizer, SanitizeOptions, SanitizeResult, StrippedMetadataInfo } from '../types.js';
import { spliceOutRanges } from '../utils/binary.js';
import { findDangerousMetadata } from '../utils/metadata-scan.js';

// JPEG markers
const MARKER_PREFIX = 0xFF;
const SOI = 0xD8; // Start of Image
const SOS = 0xDA; // Start of Scan (entropy-coded image data follows)
const APP1 = 0xE1; // EXIF/XMP - STRIP
const APP13 = 0xED; // IPTC - STRIP
const COM = 0xFE; // Comment - scanned, only stripped if dangerous

// Markers that don't have a length field.
const STANDALONE_MARKERS = new Set([
  0xD8, // SOI
  0xD9, // EOI
  0x01, // TEM
  // RST0..RST7
  0xD0,
  0xD1,
  0xD2,
  0xD3,
  0xD4,
  0xD5,
  0xD6,
  0xD7,
]);

// Markers that are always stripped — binary metadata containers whose
// presence implies privacy-sensitive content (EXIF, IPTC).
const ALWAYS_STRIP_MARKERS = new Set([
  0xE1, // APP1 (EXIF/XMP) - GPS, camera info, timestamps
  0xED, // APP13 (IPTC) - location, author, keywords
]);

function isJpegSignature(data: Uint8Array): boolean {
  return data.length >= 2
    && data[0] === MARKER_PREFIX
    && data[1] === SOI;
}

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
    const stripRanges: Array<readonly [number, number]> = [];
    let hadTextMetadata = false;
    let hadTimestamps = false;

    let offset = 2; // Skip SOI

    while (offset < data.length - 1) {
      if (data[offset] !== MARKER_PREFIX) {
        throw new CorruptedFileError(`Invalid JPEG: expected marker at offset ${offset}`);
      }

      // Skip JPEG fill bytes — only the last 0xFF before the marker code is
      // the real introducer. Any leading fill stays in place.
      while (offset < data.length - 1 && data[offset + 1] === MARKER_PREFIX) {
        offset++;
      }

      if (offset >= data.length - 1) {
        throw new CorruptedFileError('Invalid JPEG: unexpected end of file');
      }

      const marker = data[offset + 1];

      // Stop at SOS. Entropy-coded scan data follows, and progressive JPEGs
      // interleave more SOS / DHT / DQT segments in between scans — we'd
      // truncate the file if we tried to parse our way through it.
      if (marker === SOS) {
        break;
      }

      if (STANDALONE_MARKERS.has(marker)) {
        offset += 2;
        continue;
      }

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

      if (ALWAYS_STRIP_MARKERS.has(marker)) {
        strippedChunks.push(getMarkerName(marker));
        stripRanges.push([offset, segmentEnd] as const);

        if (marker === APP1) {
          hadTimestamps = true;
          hadTextMetadata = true;
        } else if (marker === APP13) {
          hadTextMetadata = true;
        }
      } else if (marker === COM) {
        // Comments are kept by default — they often hold benign content
        // like tool signatures or captions. Only strip when the payload
        // actually contains GPS / location / face-recognition patterns.
        const payload = data.subarray(offset + 4, segmentEnd);
        if (findDangerousMetadata(payload).dangerous) {
          strippedChunks.push(getMarkerName(marker));
          stripRanges.push([offset, segmentEnd] as const);
          hadTextMetadata = true;
        }
      }

      offset = segmentEnd;
    }

    const strippedMetadata: StrippedMetadataInfo = {
      hadTextMetadata,
      hadTimestamps,
      strippedChunks: strippedChunks.length > 0 ? strippedChunks : undefined,
    };

    return {
      data: spliceOutRanges(data, stripRanges),
      fileType: 'jpeg',
      strippedMetadata,
      ignored: false,
    };
  }
}

function getMarkerName(marker: number): string {
  if (marker >= 0xE0 && marker <= 0xEF) {
    return `APP${marker - 0xE0}`;
  }

  switch (marker) {
    case 0xFE:
      return 'COM';
    case 0xDB:
      return 'DQT';
    case 0xC4:
      return 'DHT';
    case 0xDA:
      return 'SOS';
    case 0xDD:
      return 'DRI';
    default:
      if (marker >= 0xC0 && marker <= 0xCF) {
        return `SOF${marker - 0xC0}`;
      }
      return `0x${marker.toString(16).toUpperCase().padStart(2, '0')}`;
  }
}
