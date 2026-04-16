/**
 * WebP file sanitizer
 *
 * WebP uses RIFF container format:
 * - RIFF header (4 bytes): "RIFF"
 * - File size (4 bytes, little-endian): total size - 8
 * - WebP signature (4 bytes): "WEBP"
 * - Chunks: each has FourCC (4 bytes), size (4 bytes LE), data (padded to even)
 *
 * Uses a BLOCKLIST approach - only strips chunks known to contain
 * privacy-sensitive metadata (EXIF, XMP). All other chunks including
 * unknown ones are preserved. Updates VP8X flags accordingly.
 */

import { CorruptedFileError } from '@laikacms/core';
import type { FileSanitizer, SanitizeOptions, SanitizeResult, StrippedMetadataInfo } from '../types.js';
import { concatBytes, readUint32LE, sliceBytes, writeUint32LE } from '../utils/binary.js';

// RIFF/WebP signatures
const RIFF_SIGNATURE = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
const WEBP_SIGNATURE = new Uint8Array([0x57, 0x45, 0x42, 0x50]); // "WEBP"

// Metadata chunks to strip (blocklist)
const DANGEROUS_CHUNKS = new Set([
  'EXIF', // EXIF metadata - GPS, camera info, timestamps
  'XMP ', // XMP metadata - may contain location, author info (note: space at end)
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

      // Decide whether to strip this chunk (BLOCKLIST approach)
      if (DANGEROUS_CHUNKS.has(fourCC)) {
        // Known dangerous metadata chunk - strip it
        strippedMetadata.strippedChunks?.push(fourCC.trim());

        if (fourCC === 'EXIF') {
          strippedMetadata.hadTextMetadata = true;
          strippedMetadata.hadTimestamps = true;
        }
        if (fourCC === 'XMP ') {
          strippedMetadata.hadTextMetadata = true;
        }
      } else {
        // Keep everything else (VP8, VP8L, VP8X, ANIM, ANMF, ALPH, ICCP, unknown chunks)
        keptChunks.push({
          fourCC,
          data: sliceBytes(data, offset, offset + 8 + paddedSize),
        });
      }

      offset += 8 + paddedSize;
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

    // We always strip XMP and EXIF, so clear those bits
    flags &= ~(1 << 2); // Clear XMP bit
    flags &= ~(1 << 3); // Clear EXIF bit

    // Create a copy and update the flags
    const result = new Uint8Array(data);
    result[flagsOffset] = flags;

    return result;
  }
}
