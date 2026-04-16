/**
 * GIF file sanitizer
 *
 * GIF has a simple block-based structure:
 * - Header (GIF87a or GIF89a)
 * - Logical Screen Descriptor
 * - Global Color Table (optional)
 * - Extension blocks and image data
 * - Trailer (0x3B)
 *
 * Uses a BLOCKLIST approach - only strips extensions known to contain
 * privacy-sensitive metadata (comments, plain text). All other blocks
 * including application extensions (NETSCAPE2.0 for looping) are preserved.
 */

import { CorruptedFileError } from '@laikacms/core';
import type { FileSanitizer, SanitizeOptions, SanitizeResult, StrippedMetadataInfo } from '../types.js';
import { concatBytes, sliceBytes } from '../utils/binary.js';

// GIF signatures
const GIF87A = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]); // GIF87a
const GIF89A = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a

// Extension introducer
const EXTENSION_INTRODUCER = 0x21;

// Extension labels
const GRAPHICS_CONTROL_EXTENSION = 0xF9; // Keep - needed for animation
const COMMENT_EXTENSION = 0xFE; // Strip - may contain text metadata
const PLAIN_TEXT_EXTENSION = 0x01; // Strip - may contain text metadata

// Image separator
const IMAGE_SEPARATOR = 0x2C;

// Trailer
const TRAILER = 0x3B;

/**
 * Check if data starts with GIF signature
 */
function isGifSignature(data: Uint8Array): boolean {
  if (data.length < 6) return false;

  let is87a = true;
  let is89a = true;

  for (let i = 0; i < 6; i++) {
    if (data[i] !== GIF87A[i]) is87a = false;
    if (data[i] !== GIF89A[i]) is89a = false;
  }

  return is87a || is89a;
}

/**
 * Skip sub-blocks (used by extensions and image data)
 * Returns the offset after the block terminator (0x00)
 */
function skipSubBlocks(data: Uint8Array, offset: number): number {
  while (offset < data.length) {
    const blockSize = data[offset];
    if (blockSize === 0) {
      return offset + 1; // Skip the terminator
    }
    offset += 1 + blockSize;
  }
  return offset;
}

/**
 * Copy sub-blocks from data starting at offset, returning the data and new offset
 */
function copySubBlocks(data: Uint8Array, offset: number): { bytes: Uint8Array, newOffset: number } {
  const start = offset;
  const end = skipSubBlocks(data, offset);
  return { bytes: sliceBytes(data, start, end), newOffset: end };
}

export class GifSanitizer implements FileSanitizer {
  readonly fileType = 'gif' as const;

  canHandle(data: Uint8Array): boolean {
    return isGifSignature(data);
  }

  async sanitize(data: Uint8Array, _options: SanitizeOptions): Promise<SanitizeResult> {
    if (!this.canHandle(data)) {
      throw new CorruptedFileError('Invalid GIF signature');
    }

    const strippedMetadata: StrippedMetadataInfo = {
      hadTextMetadata: false,
      hadTimestamps: false,
      strippedChunks: [],
    };

    const outputChunks: Uint8Array[] = [];

    // Copy header (6 bytes)
    outputChunks.push(sliceBytes(data, 0, 6));

    // Copy Logical Screen Descriptor (7 bytes)
    if (data.length < 13) {
      throw new CorruptedFileError('GIF too short for screen descriptor');
    }
    outputChunks.push(sliceBytes(data, 6, 13));

    // Check for Global Color Table
    const packedByte = data[10];
    const hasGlobalColorTable = (packedByte & 0x80) !== 0;
    const globalColorTableSize = hasGlobalColorTable ? 3 * (1 << ((packedByte & 0x07) + 1)) : 0;

    let offset = 13;

    // Copy Global Color Table if present
    if (hasGlobalColorTable) {
      if (offset + globalColorTableSize > data.length) {
        throw new CorruptedFileError('GIF truncated in global color table');
      }
      outputChunks.push(sliceBytes(data, offset, offset + globalColorTableSize));
      offset += globalColorTableSize;
    }

    // Process blocks
    while (offset < data.length) {
      const blockType = data[offset];

      if (blockType === TRAILER) {
        // End of GIF
        outputChunks.push(new Uint8Array([TRAILER]));
        break;
      }

      if (blockType === EXTENSION_INTRODUCER) {
        if (offset + 1 >= data.length) {
          throw new CorruptedFileError('GIF truncated in extension');
        }

        const extensionLabel = data[offset + 1];

        if (extensionLabel === COMMENT_EXTENSION) {
          // Strip comment extension - may contain personal metadata
          strippedMetadata.hadTextMetadata = true;
          strippedMetadata.strippedChunks?.push('Comment');
          offset = skipSubBlocks(data, offset + 2);
        } else if (extensionLabel === PLAIN_TEXT_EXTENSION) {
          // Strip plain text extension - may contain personal metadata
          strippedMetadata.hadTextMetadata = true;
          strippedMetadata.strippedChunks?.push('PlainText');
          offset = skipSubBlocks(data, offset + 2);
        } else if (extensionLabel === GRAPHICS_CONTROL_EXTENSION) {
          // Keep graphics control extension (needed for animation)
          // Fixed size: introducer (1) + label (1) + block size (1) + data (4) + terminator (1) = 8 bytes
          if (offset + 8 > data.length) {
            throw new CorruptedFileError('GIF truncated in graphics control extension');
          }
          outputChunks.push(sliceBytes(data, offset, offset + 8));
          offset += 8;
        } else {
          // Keep all other extensions (application extensions like NETSCAPE2.0, unknown extensions, etc.)
          const blockStart = offset;
          offset += 2; // Skip introducer + label
          const { bytes: subBlockBytes, newOffset } = copySubBlocks(data, offset);
          outputChunks.push(sliceBytes(data, blockStart, blockStart + 2)); // introducer + label
          outputChunks.push(subBlockBytes);
          offset = newOffset;
        }
      } else if (blockType === IMAGE_SEPARATOR) {
        // Image descriptor - keep it
        if (offset + 10 > data.length) {
          throw new CorruptedFileError('GIF truncated in image descriptor');
        }

        // Copy image descriptor (10 bytes)
        outputChunks.push(sliceBytes(data, offset, offset + 10));

        // Check for Local Color Table
        const imagePackedByte = data[offset + 9];
        const hasLocalColorTable = (imagePackedByte & 0x80) !== 0;
        const localColorTableSize = hasLocalColorTable ? 3 * (1 << ((imagePackedByte & 0x07) + 1)) : 0;

        offset += 10;

        // Copy Local Color Table if present
        if (hasLocalColorTable) {
          if (offset + localColorTableSize > data.length) {
            throw new CorruptedFileError('GIF truncated in local color table');
          }
          outputChunks.push(sliceBytes(data, offset, offset + localColorTableSize));
          offset += localColorTableSize;
        }

        // Copy LZW minimum code size
        if (offset >= data.length) {
          throw new CorruptedFileError('GIF truncated before LZW data');
        }
        outputChunks.push(sliceBytes(data, offset, offset + 1));
        offset += 1;

        // Copy image data sub-blocks
        const imageDataStart = offset;
        offset = skipSubBlocks(data, offset);
        outputChunks.push(sliceBytes(data, imageDataStart, offset));
      } else {
        // Unknown block type - keep it rather than rejecting the file
        // Skip one byte and continue (best-effort tolerance)
        outputChunks.push(sliceBytes(data, offset, offset + 1));
        offset += 1;
      }
    }

    return {
      data: concatBytes(...outputChunks),
      fileType: 'gif',
      strippedMetadata,
      ignored: false,
    };
  }
}
