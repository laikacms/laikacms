/**
 * Binary parsing utilities for file sanitization
 * Works with Uint8Array without native bindings
 */

/**
 * Read a 16-bit unsigned integer (big-endian)
 */
export function readUint16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

/**
 * Read a 16-bit unsigned integer (little-endian)
 */
export function readUint16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

/**
 * Read a 32-bit unsigned integer (big-endian)
 */
export function readUint32BE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] << 24)
    | (data[offset + 1] << 16)
    | (data[offset + 2] << 8)
    | data[offset + 3]
  ) >>> 0;
}

/**
 * Read a 32-bit unsigned integer (little-endian)
 */
export function readUint32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset]
    | (data[offset + 1] << 8)
    | (data[offset + 2] << 16)
    | (data[offset + 3] << 24)
  ) >>> 0;
}

/**
 * Write a 16-bit unsigned integer (big-endian)
 */
export function writeUint16BE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >> 8) & 0xFF;
  data[offset + 1] = value & 0xFF;
}

/**
 * Write a 16-bit unsigned integer (little-endian)
 */
export function writeUint16LE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xFF;
  data[offset + 1] = (value >> 8) & 0xFF;
}

/**
 * Write a 32-bit unsigned integer (big-endian)
 */
export function writeUint32BE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >> 24) & 0xFF;
  data[offset + 1] = (value >> 16) & 0xFF;
  data[offset + 2] = (value >> 8) & 0xFF;
  data[offset + 3] = value & 0xFF;
}

/**
 * Write a 32-bit unsigned integer (little-endian)
 */
export function writeUint32LE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xFF;
  data[offset + 1] = (value >> 8) & 0xFF;
  data[offset + 2] = (value >> 16) & 0xFF;
  data[offset + 3] = (value >> 24) & 0xFF;
}

/**
 * Compare two byte sequences
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array, aOffset = 0, bOffset = 0, length?: number): boolean {
  const len = length ?? Math.min(a.length - aOffset, b.length - bOffset);
  for (let i = 0; i < len; i++) {
    if (a[aOffset + i] !== b[bOffset + i]) {
      return false;
    }
  }
  return true;
}

/**
 * Find a byte sequence in data
 */
export function findBytes(data: Uint8Array, pattern: Uint8Array, startOffset = 0): number {
  const patternLen = pattern.length;
  const dataLen = data.length;

  for (let i = startOffset; i <= dataLen - patternLen; i++) {
    let found = true;
    for (let j = 0; j < patternLen; j++) {
      if (data[i + j] !== pattern[j]) {
        found = false;
        break;
      }
    }
    if (found) {
      return i;
    }
  }
  return -1;
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Create a slice of a Uint8Array (copy)
 */
export function sliceBytes(data: Uint8Array, start: number, end?: number): Uint8Array {
  return data.slice(start, end);
}

/**
 * Splice out the given byte ranges from `data` and return a new Uint8Array
 * with those ranges removed. Ranges are `[start, end)` (end exclusive),
 * must be non-overlapping, and must be supplied in ascending order.
 *
 * If `ranges` is empty, the original `data` reference is returned
 * unchanged — the bytes are not copied.
 */
export function spliceOutRanges(
  data: Uint8Array,
  ranges: ReadonlyArray<readonly [number, number]>,
): Uint8Array {
  if (ranges.length === 0) return data;
  const totalStripped = ranges.reduce((sum, [s, e]) => sum + (e - s), 0);
  const output = new Uint8Array(data.length - totalStripped);
  let outPos = 0;
  let inPos = 0;
  for (const [start, end] of ranges) {
    output.set(data.subarray(inPos, start), outPos);
    outPos += start - inPos;
    inPos = end;
  }
  output.set(data.subarray(inPos), outPos);
  return output;
}

/**
 * Check if data starts with a specific pattern
 */
export function startsWith(data: Uint8Array, pattern: Uint8Array | readonly number[] | number[]): boolean {
  const patternArray = pattern instanceof Uint8Array ? pattern : pattern;
  if (data.length < patternArray.length) {
    return false;
  }
  for (let i = 0; i < patternArray.length; i++) {
    if (data[i] !== patternArray[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Read a null-terminated string from data
 */
export function readNullTerminatedString(data: Uint8Array, offset: number, maxLength?: number): string {
  const bytes: number[] = [];
  const limit = maxLength ? Math.min(offset + maxLength, data.length) : data.length;

  for (let i = offset; i < limit; i++) {
    if (data[i] === 0) {
      break;
    }
    bytes.push(data[i]);
  }

  return String.fromCharCode(...bytes);
}

/**
 * Read a fixed-length string from data
 */
export function readFixedString(data: Uint8Array, offset: number, length: number): string {
  const bytes: number[] = [];
  for (let i = 0; i < length && offset + i < data.length; i++) {
    const byte = data[offset + i];
    if (byte === 0) break;
    bytes.push(byte);
  }
  return String.fromCharCode(...bytes);
}
