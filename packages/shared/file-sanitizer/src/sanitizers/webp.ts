/**
 * WebP file sanitizer
 *
 * WebP uses RIFF container format:
 * - RIFF header (4 bytes): "RIFF"
 * - File size (4 bytes, little-endian): total size - 8
 * - WebP signature (4 bytes): "WEBP"
 * - Chunks: each has FourCC (4 bytes), size (4 bytes LE), data (padded to even)
 *
 * We strip metadata chunks (EXIF, XMP) and update the RIFF header size.
 *
 * Safe chunks to keep:
 * - VP8 (lossy image data)
 * - VP8L (lossless image data)
 * - VP8X (extended features header)
 * - ANIM (animation parameters)
 * - ANMF (animation frame)
 * - ALPH (alpha channel)
 * - ICCP (ICC color profile - needed for color accuracy)
 *
 * Metadata chunks to strip:
 * - EXIF (EXIF metadata)
 * - XMP (XMP metadata)
 */

import { CorruptedFileError } from '@laikacms/core';
import type { FileSanitizer, SanitizeOptions, SanitizeResult, StrippedMetadataInfo } from '../types.js';
import { concatBytes, readUint32LE, sliceBytes, writeUint32LE } from '../utils/binary.js';

// RIFF/WebP signatures
const RIFF_SIGNATURE = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
const WEBP_SIGNATURE = new Uint8Array([0x57, 0x45, 0x42, 0x50]); // "WEBP"

// Safe chunks (whitelist)
const SAFE_CHUNKS = new Set([
  'VP8 ', // Lossy image data (note: space at end)
  'VP8L', // Lossless image data
  'VP8X', // Extended features
  'ANIM', // Animation parameters
  'ANMF', // Animation frame
  'ALPH', // Alpha channel
  'ICCP', // ICC color profile (needed for color accuracy)
]);

// Metadata chunks (always stripped)
const METADATA_CHUNKS = new Set([
  'EXIF', // EXIF metadata
  'XMP ', // XMP metadata (note: space at end)
]);

/**
 * Read a FourCC (4-character code) as a string
 */
function readFourCC(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  );
}

export class WebpSanitizer implements FileSanitizer {
  readonly fileType = 'webp' as const;

  canHandle(data: Uint8Array): boolean {
    if (data.length < 12) return false;

    // Check RIFF signature
    for (let i = 0; i < 4; i++) {
      if (data[i] !== RIFF_SIGNATURE[i]) return false;
    }

    // Check WEBP signature at offset 8
    for (let i = 0; i < 4; i++) {
      if (data[8 + i] !== WEBP_SIGNATURE[i]) return false;
    }

    return true;
  }

  async sanitize(data: Uint8Array, _options: SanitizeOptions): Promise<SanitizeResult> {
    if (!this.canHandle(data)) {
      throw new CorruptedFileError('Invalid WebP signature');
    }

    const strippedMetadata: StrippedMetadataInfo = {
      hadTextMetadata: false,
      hadTimestamps: false,
      strippedChunks: [],
    };

    // Collect chunks to keep
    const keptChunks: Array<{ fourCC: string, data: Uint8Array }> = [];

    let offset = 12; // Skip RIFF header (4) + size (4) + WEBP (4)

    while (offset < data.length - 8) {
      // Read chunk FourCC
      const fourCC = readFourCC(data, offset);

      // Read chunk size (little-endian)
      const chunkSize = readUint32LE(data, offset + 4);

      // Calculate padded size (chunks are padded to even byte boundary)
      const paddedSize = chunkSize + (chunkSize % 2);

      // Validate chunk doesn't extend beyond file
      if (offset + 8 + paddedSize > data.length) {
        throw new CorruptedFileError(`Chunk ${fourCC} extends beyond file`);
      }

      // Decide whether to keep this chunk (WHITELIST approach)
      let keepChunk = false;

      if (SAFE_CHUNKS.has(fourCC)) {
        // Safe chunk - keep it
        keepChunk = true;
      } else if (METADATA_CHUNKS.has(fourCC)) {
        // Metadata chunk - always strip
        keepChunk = false;
        strippedMetadata.strippedChunks?.push(fourCC.trim());

        if (fourCC === 'EXIF') {
          strippedMetadata.hadTextMetadata = true;
        }
        if (fourCC === 'XMP ') {
          strippedMetadata.hadTextMetadata = true;
        }
      } else {
        // Unknown chunk - strip it (not in whitelist)
        keepChunk = false;
        strippedMetadata.strippedChunks?.push(fourCC.trim());
      }

      if (keepChunk) {
        // Copy chunk header + data (including padding)
        keptChunks.push({
          fourCC,
          data: sliceBytes(data, offset, offset + 8 + paddedSize),
        });
      }

      offset += 8 + paddedSize;
    }

    // Check we have at least one image data chunk
    const hasImageData = keptChunks.some(c => c.fourCC === 'VP8 ' || c.fourCC === 'VP8L' || c.fourCC === 'ANMF');

    if (!hasImageData) {
      throw new CorruptedFileError('No image data found in WebP');
    }

    // Build output: RIFF header + WEBP + chunks
    const chunksData = concatBytes(...keptChunks.map(c => c.data));

    // Calculate new file size (total - 8 for RIFF header)
    const newFileSize = 4 + chunksData.length; // WEBP (4) + chunks

    // Build RIFF header with corrected size
    const riffHeader = new Uint8Array(12);
    riffHeader.set(RIFF_SIGNATURE, 0);
    writeUint32LE(riffHeader, 4, newFileSize);
    riffHeader.set(WEBP_SIGNATURE, 8);

    // If we have VP8X chunk, we may need to update its flags
    const outputData = concatBytes(riffHeader, chunksData);
    const updatedData = this.updateVP8XFlags(outputData, keptChunks);

    return {
      data: updatedData,
      fileType: 'webp',
      strippedMetadata,
      ignored: false,
    };
  }

  /**
   * Update VP8X flags to reflect which chunks are actually present
   */
  private updateVP8XFlags(
    data: Uint8Array,
    keptChunks: Array<{ fourCC: string, data: Uint8Array }>,
  ): Uint8Array {
    // Find VP8X chunk
    const vp8xIndex = keptChunks.findIndex(c => c.fourCC === 'VP8X');
    if (vp8xIndex === -1) {
      // No VP8X chunk, nothing to update
      return data;
    }

    // VP8X chunk is at offset 12 (after RIFF header)
    // VP8X structure: FourCC (4) + size (4) + flags (4) + reserved (3) + width-1 (3) + height-1 (3)
    // Flags byte is at offset 12 + 8 = 20

    // Calculate actual offset of VP8X in output
    let vp8xOffset = 12; // After RIFF header
    for (let i = 0; i < vp8xIndex; i++) {
      vp8xOffset += keptChunks[i].data.length;
    }

    // Read current flags
    const flagsOffset = vp8xOffset + 8;
    if (flagsOffset >= data.length) {
      return data;
    }

    let flags = data[flagsOffset];

    // VP8X flags (bit positions):
    // bit 0: reserved
    // bit 1: Animation
    // bit 2: XMP metadata
    // bit 3: EXIF metadata
    // bit 4: Alpha
    // bit 5: ICC profile

    // Check what we actually have
    const hasAnimation = keptChunks.some(c => c.fourCC === 'ANIM' || c.fourCC === 'ANMF');
    const hasAlpha = keptChunks.some(c => c.fourCC === 'ALPH');
    const hasICC = keptChunks.some(c => c.fourCC === 'ICCP');

    // We always strip XMP and EXIF, so clear those bits
    flags &= ~(1 << 2); // Clear XMP bit
    flags &= ~(1 << 3); // Clear EXIF bit

    // Update other flags based on what's present
    if (hasAnimation) {
      flags |= 1 << 1;
    } else {
      flags &= ~(1 << 1);
    }

    if (hasAlpha) {
      flags |= 1 << 4;
    } else {
      flags &= ~(1 << 4);
    }

    if (hasICC) {
      flags |= 1 << 5;
    } else {
      flags &= ~(1 << 5);
    }

    // Create a copy and update the flags
    const result = new Uint8Array(data);
    result[flagsOffset] = flags;

    return result;
  }
}
