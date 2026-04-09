/**
 * PNG file sanitizer
 *
 * PNG has a simple chunk-based structure that's easy to safely modify:
 * - 8-byte signature
 * - Sequence of chunks, each with: length (4 bytes), type (4 bytes), data, CRC (4 bytes)
 *
 * We use a WHITELIST approach - only safe chunks are preserved.
 * Metadata chunks (tEXt, zTXt, iTXt, tIME, eXIf) are stripped.
 */

import { CorruptedFileError } from '@laikacms/core';
import type { FileSanitizer, SanitizeOptions, SanitizeResult, StrippedMetadataInfo } from '../types.js';
import { PNG_METADATA_CHUNKS, SAFE_PNG_CHUNKS } from '../types.js';
import { concatBytes, readUint32BE, sliceBytes } from '../utils/binary.js';

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
    // Validate PNG signature
    if (!this.canHandle(data)) {
      throw new CorruptedFileError('Invalid PNG signature');
    }

    const strippedMetadata: StrippedMetadataInfo = {
      hadTextMetadata: false,
      hadTimestamps: false,
      strippedChunks: [],
    };

    const outputChunks: Uint8Array[] = [];

    // Add PNG signature
    outputChunks.push(PNG_SIGNATURE);

    let offset = 8; // Skip signature
    let hasIHDR = false;
    let hasIEND = false;

    while (offset + 12 <= data.length) { // Minimum chunk size is 12 bytes (4 + 4 + 0 + 4)
      // Read chunk length
      const chunkLength = readUint32BE(data, offset);

      // Sanity check chunk length
      if (chunkLength > data.length - offset - 12) {
        throw new CorruptedFileError('Invalid chunk length');
      }

      // Read chunk type
      const chunkType = readChunkType(data, offset + 4);

      // Calculate chunk end (length + type + data + CRC)
      const chunkEnd = offset + 4 + 4 + chunkLength + 4;

      if (chunkEnd > data.length) {
        throw new CorruptedFileError('Chunk extends beyond file');
      }

      // Verify CRC
      const chunkData = sliceBytes(data, offset + 4, offset + 8 + chunkLength); // type + data
      const storedCRC = readUint32BE(data, offset + 8 + chunkLength);
      const calculatedCRC = crc32(chunkData);

      if (storedCRC !== calculatedCRC) {
        throw new CorruptedFileError(`Invalid CRC for chunk ${chunkType}`);
      }

      // Track critical chunks
      if (chunkType === 'IHDR') hasIHDR = true;
      if (chunkType === 'IEND') hasIEND = true;

      // Decide whether to keep this chunk (WHITELIST approach)
      let keepChunk;

      if (SAFE_PNG_CHUNKS.has(chunkType)) {
        // Safe chunk - keep it
        keepChunk = true;
      } else if (PNG_METADATA_CHUNKS.has(chunkType)) {
        // Metadata chunk - always strip
        keepChunk = false;
        strippedMetadata.strippedChunks?.push(chunkType);

        // Track what kind of metadata was stripped
        if (chunkType === 'tEXt' || chunkType === 'zTXt' || chunkType === 'iTXt') {
          strippedMetadata.hadTextMetadata = true;
        }
        if (chunkType === 'tIME') {
          strippedMetadata.hadTimestamps = true;
        }
      } else {
        // Unknown chunk - strip it (not in whitelist)
        keepChunk = false;
        strippedMetadata.strippedChunks?.push(chunkType);
      }

      if (keepChunk) {
        // Copy the entire chunk (length + type + data + CRC)
        outputChunks.push(sliceBytes(data, offset, chunkEnd));
      }

      offset = chunkEnd;
    }

    // Validate we have required chunks
    if (!hasIHDR) {
      throw new CorruptedFileError('Missing IHDR chunk');
    }
    if (!hasIEND) {
      throw new CorruptedFileError('Missing IEND chunk');
    }

    return {
      data: concatBytes(...outputChunks),
      fileType: 'png',
      strippedMetadata,
      ignored: false,
    };
  }
}
