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
 * privacy-sensitive metadata (EXIF, XMP). Every other chunk (VP8/VP8L,
 * VP8X, ANIM/ANMF, ALPH, ICCP, unknown chunks) is copied through verbatim.
 *
 * When something is stripped: the RIFF size header is corrected and the
 * VP8X flag bits for whichever chunks were actually removed (bit 2 = XMP,
 * bit 3 = EXIF) are cleared. When nothing is stripped the original
 * Uint8Array reference is returned unchanged.
 */

import { CorruptedFileError } from '@laikacms/core';
import type { FileSanitizer, SanitizeOptions, SanitizeResult, StrippedMetadataInfo } from '../types.js';
import { readUint32LE, spliceOutRanges, writeUint32LE } from '../utils/binary.js';

// RIFF/WebP signatures
const RIFF_SIGNATURE = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
const WEBP_SIGNATURE = new Uint8Array([0x57, 0x45, 0x42, 0x50]); // "WEBP"

// Metadata chunks to strip (blocklist)
const DANGEROUS_CHUNKS = new Set([
  'EXIF', // EXIF metadata - GPS, camera info, timestamps
  'XMP ', // XMP metadata - may contain location, author info (note: space at end)
]);

// VP8X flag bits we may need to clear when their chunk is removed.
const VP8X_XMP_BIT = 1 << 2;
const VP8X_EXIF_BIT = 1 << 3;

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

    for (let i = 0; i < 4; i++) {
      if (data[i] !== RIFF_SIGNATURE[i]) return false;
    }
    for (let i = 0; i < 4; i++) {
      if (data[8 + i] !== WEBP_SIGNATURE[i]) return false;
    }

    return true;
  }

  async sanitize(data: Uint8Array, _options: SanitizeOptions): Promise<SanitizeResult> {
    if (!this.canHandle(data)) {
      throw new CorruptedFileError('Invalid WebP signature');
    }

    const strippedChunks: string[] = [];
    const stripRanges: Array<readonly [number, number]> = [];
    let hadTextMetadata = false;
    let hadTimestamps = false;
    let vp8xOffset = -1;
    let strippedExif = false;
    let strippedXmp = false;

    let offset = 12; // Skip RIFF header (4) + size (4) + WEBP (4)

    while (offset + 8 <= data.length) {
      const fourCC = readFourCC(data, offset);
      const chunkSize = readUint32LE(data, offset + 4);
      // Chunks are padded to an even byte boundary.
      const paddedSize = chunkSize + (chunkSize % 2);
      const chunkEnd = offset + 8 + paddedSize;

      if (chunkEnd > data.length) {
        throw new CorruptedFileError(`Chunk ${fourCC} extends beyond file`);
      }

      if (fourCC === 'VP8X') {
        vp8xOffset = offset;
      }

      if (DANGEROUS_CHUNKS.has(fourCC)) {
        strippedChunks.push(fourCC.trim());
        stripRanges.push([offset, chunkEnd] as const);

        if (fourCC === 'EXIF') {
          strippedExif = true;
          hadTextMetadata = true;
          hadTimestamps = true;
        } else if (fourCC === 'XMP ') {
          strippedXmp = true;
          hadTextMetadata = true;
        }
      }

      offset = chunkEnd;
    }

    const strippedMetadata: StrippedMetadataInfo = {
      hadTextMetadata,
      hadTimestamps,
      strippedChunks,
    };

    if (stripRanges.length === 0) {
      return {
        data,
        fileType: 'webp',
        strippedMetadata,
        ignored: false,
      };
    }

    const output = spliceOutRanges(data, stripRanges);

    // RIFF size is total file length minus the 8-byte "RIFF<size>" header.
    writeUint32LE(output, 4, output.length - 8);

    // VP8X (if present) sits before EXIF/XMP, so its position in `output`
    // matches its position in `data`. Update only the flag bits whose
    // chunk we actually removed — leave the others alone.
    if (vp8xOffset !== -1 && (strippedExif || strippedXmp)) {
      const flagsOffset = vp8xOffset + 8;
      if (flagsOffset < output.length) {
        let flags = output[flagsOffset];
        if (strippedXmp) flags &= ~VP8X_XMP_BIT;
        if (strippedExif) flags &= ~VP8X_EXIF_BIT;
        output[flagsOffset] = flags;
      }
    }

    return {
      data: output,
      fileType: 'webp',
      strippedMetadata,
      ignored: false,
    };
  }
}
