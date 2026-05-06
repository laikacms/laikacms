/**
 * PNG file sanitizer
 *
 * PNG has a simple chunk-based structure:
 * - 8-byte signature
 * - Sequence of chunks, each with: length (4 bytes), type (4 bytes), data, CRC (4 bytes)
 *
 * Stripping rules:
 * - tIME, eXIf, zTXt: always stripped (timestamps, EXIF binary, opaque
 *   compressed text)
 * - tEXt, iTXt: payload is scanned and only stripped when it contains
 *   GPS / location / face-recognition patterns. Benign text chunks
 *   (tool attribution, captions, descriptions) are preserved.
 *
 * When chunks are stripped we splice them out surgically; every other
 * byte (signature, IHDR, IDAT, IEND, ancillary chunks, unknown chunks,
 * padding) is copied through verbatim. When nothing is stripped the
 * original Uint8Array reference is returned unchanged.
 */

import { CorruptedFileError } from '@laikacms/core';
import type { FileSanitizer, SanitizeOptions, SanitizeResult, StrippedMetadataInfo } from '../types.js';
import { readUint32BE, sliceBytes, spliceOutRanges } from '../utils/binary.js';
import { findDangerousMetadata } from '../utils/metadata-scan.js';

// Chunks that are always stripped — privacy-sensitive by structure.
const ALWAYS_STRIP_CHUNKS = new Set([
  'tIME', // Last-modification timestamp
  'eXIf', // EXIF binary blob
  'zTXt', // Compressed text — opaque, can't be scanned in-place
]);

// Text chunks that are scanned; only stripped when their payload matches
// a dangerous pattern. iTXt may carry XMP packets (which can hold GPS or
// region data) but is just as often a plain caption.
const SCANNABLE_TEXT_CHUNKS = new Set(['tEXt', 'iTXt']);

// PNG signature: 89 50 4E 47 0D 0A 1A 0A
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

/**
 * Calculate CRC32 for PNG chunk validation
 * Uses the standard CRC-32 polynomial used by PNG
 */
function crc32(data: Uint8Array): number {
  // CRC32 lookup table
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Read a chunk type as a 4-character string
 */
function readChunkType(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  );
}

export class PngSanitizer implements FileSanitizer {
  readonly fileType = 'png' as const;

  canHandle(data: Uint8Array): boolean {
    if (data.length < 8) return false;
    for (let i = 0; i < 8; i++) {
      if (data[i] !== PNG_SIGNATURE[i]) return false;
    }
    return true;
  }

  async sanitize(data: Uint8Array, _options: SanitizeOptions): Promise<SanitizeResult> {
    if (!this.canHandle(data)) {
      throw new CorruptedFileError('Invalid PNG signature');
    }

    const strippedChunks: string[] = [];
    const stripRanges: Array<readonly [number, number]> = [];
    let hadTextMetadata = false;
    let hadTimestamps = false;
    let hasIHDR = false;
    let hasIEND = false;

    let offset = 8; // Skip signature

    while (offset + 12 <= data.length) {
      const chunkLength = readUint32BE(data, offset);

      // Sanity check chunk length
      if (chunkLength > data.length - offset - 12) {
        throw new CorruptedFileError('Invalid chunk length');
      }

      const chunkType = readChunkType(data, offset + 4);
      const chunkEnd = offset + 4 + 4 + chunkLength + 4;

      if (chunkEnd > data.length) {
        throw new CorruptedFileError('Chunk extends beyond file');
      }

      // Verify CRC over type + data
      const chunkData = sliceBytes(data, offset + 4, offset + 8 + chunkLength);
      const storedCRC = readUint32BE(data, offset + 8 + chunkLength);
      const calculatedCRC = crc32(chunkData);
      if (storedCRC !== calculatedCRC) {
        throw new CorruptedFileError(`Invalid CRC for chunk ${chunkType}`);
      }

      if (chunkType === 'IHDR') hasIHDR = true;
      if (chunkType === 'IEND') hasIEND = true;

      if (ALWAYS_STRIP_CHUNKS.has(chunkType)) {
        strippedChunks.push(chunkType);
        stripRanges.push([offset, chunkEnd] as const);

        if (chunkType === 'zTXt') {
          hadTextMetadata = true;
        }
        if (chunkType === 'tIME') {
          hadTimestamps = true;
        }
      } else if (SCANNABLE_TEXT_CHUNKS.has(chunkType)) {
        const payload = data.subarray(offset + 8, offset + 8 + chunkLength);
        if (findDangerousMetadata(payload).dangerous) {
          strippedChunks.push(chunkType);
          stripRanges.push([offset, chunkEnd] as const);
          hadTextMetadata = true;
        }
      }

      offset = chunkEnd;
    }

    if (!hasIHDR) {
      throw new CorruptedFileError('Missing IHDR chunk');
    }
    if (!hasIEND) {
      throw new CorruptedFileError('Missing IEND chunk');
    }

    return {
      data: spliceOutRanges(data, stripRanges),
      fileType: 'png',
      strippedMetadata: {
        hadTextMetadata,
        hadTimestamps,
        strippedChunks,
      } satisfies StrippedMetadataInfo,
      ignored: false,
    };
  }
}
