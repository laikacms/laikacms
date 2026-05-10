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
 * Comment (0xFE) and Plain Text (0x01) extensions can carry either
 * benign content (tool signatures, captions, attribution) or sensitive
 * metadata (GPS coordinates, face / region info). Their payloads are
 * scanned and only stripped when a dangerous pattern is found.
 *
 * Image data, graphics control extensions, application extensions
 * (NETSCAPE2.0 looping), unknown extensions, and the trailer are all
 * copied through verbatim. When nothing dangerous is present the
 * original Uint8Array reference is returned unchanged.
 */

import { CorruptedFileError } from '@laikacms/core';
import type { FileSanitizer, SanitizeOptions, SanitizeResult, StrippedMetadataInfo } from '../types.js';
import { spliceOutRanges } from '../utils/binary.js';
import { findDangerousMetadata } from '../utils/metadata-scan.js';

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
 * Walk past sub-blocks (used by extensions and image data) and return the
 * offset just after the block terminator (0x00).
 */
function skipSubBlocks(data: Uint8Array, offset: number): number {
  while (offset < data.length) {
    const blockSize = data[offset];
    if (blockSize === 0) {
      return offset + 1;
    }
    offset += 1 + blockSize;
  }
  return offset;
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

    if (data.length < 13) {
      throw new CorruptedFileError('GIF too short for screen descriptor');
    }

    const strippedChunks: string[] = [];
    const stripRanges: Array<readonly [number, number]> = [];
    let hadTextMetadata = false;

    // Skip header (6) + logical screen descriptor (7) + optional global color table.
    const packedByte = data[10];
    const hasGlobalColorTable = (packedByte & 0x80) !== 0;
    const globalColorTableSize = hasGlobalColorTable ? 3 * (1 << ((packedByte & 0x07) + 1)) : 0;

    let offset = 13;
    if (hasGlobalColorTable) {
      if (offset + globalColorTableSize > data.length) {
        throw new CorruptedFileError('GIF truncated in global color table');
      }
      offset += globalColorTableSize;
    }

    while (offset < data.length) {
      const blockType = data[offset];

      if (blockType === TRAILER) {
        break;
      }

      if (blockType === EXTENSION_INTRODUCER) {
        if (offset + 1 >= data.length) {
          throw new CorruptedFileError('GIF truncated in extension');
        }

        const extensionLabel = data[offset + 1];
        const extensionStart = offset;

        if (extensionLabel === COMMENT_EXTENSION || extensionLabel === PLAIN_TEXT_EXTENSION) {
          // Plain Text has a 12-byte fixed header before its sub-blocks; for
          // Comment the sub-blocks start right after the introducer + label.
          const subBlockStart = extensionLabel === PLAIN_TEXT_EXTENSION ? offset + 15 : offset + 2;
          offset = skipSubBlocks(data, subBlockStart);
          // Comments and plain-text extensions can carry benign content
          // (tool signatures, captions). Only strip when their payload
          // actually contains GPS / location / face-recognition patterns.
          const payload = data.subarray(subBlockStart, offset);
          if (findDangerousMetadata(payload).dangerous) {
            stripRanges.push([extensionStart, offset] as const);
            strippedChunks.push(extensionLabel === COMMENT_EXTENSION ? 'Comment' : 'PlainText');
            hadTextMetadata = true;
          }
        } else if (extensionLabel === GRAPHICS_CONTROL_EXTENSION) {
          // Fixed size: introducer (1) + label (1) + block size (1) + data (4) + terminator (1) = 8 bytes
          if (offset + 8 > data.length) {
            throw new CorruptedFileError('GIF truncated in graphics control extension');
          }
          offset += 8;
        } else {
          // Application extension (NETSCAPE2.0, etc.) or unknown — keep verbatim.
          offset = skipSubBlocks(data, offset + 2);
        }
      } else if (blockType === IMAGE_SEPARATOR) {
        if (offset + 10 > data.length) {
          throw new CorruptedFileError('GIF truncated in image descriptor');
        }

        const imagePackedByte = data[offset + 9];
        const hasLocalColorTable = (imagePackedByte & 0x80) !== 0;
        const localColorTableSize = hasLocalColorTable ? 3 * (1 << ((imagePackedByte & 0x07) + 1)) : 0;

        offset += 10;

        if (hasLocalColorTable) {
          if (offset + localColorTableSize > data.length) {
            throw new CorruptedFileError('GIF truncated in local color table');
          }
          offset += localColorTableSize;
        }

        if (offset >= data.length) {
          throw new CorruptedFileError('GIF truncated before LZW data');
        }
        offset += 1; // LZW minimum code size
        offset = skipSubBlocks(data, offset);
      } else {
        // Unknown byte — advance one byte and try to keep parsing.
        offset += 1;
      }
    }

    return {
      data: spliceOutRanges(data, stripRanges),
      fileType: 'gif',
      strippedMetadata: {
        hadTextMetadata,
        hadTimestamps: false,
        strippedChunks,
      } satisfies StrippedMetadataInfo,
      ignored: false,
    };
  }
}
