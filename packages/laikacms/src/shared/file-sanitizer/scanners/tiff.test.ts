import { describe, expect, it } from 'vitest';
import { TiffScanner } from './tiff.js';

const scanner = new TiffScanner();

/**
 * Write a 16-bit little-endian value into a buffer.
 */
function writeUint16LE(buf: number[], offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
}

/**
 * Write a 32-bit little-endian value into a buffer.
 */
function writeUint32LE(buf: number[], offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
  buf[offset + 3] = (value >> 24) & 0xff;
}

/**
 * Write a 16-bit big-endian value into a buffer.
 */
function writeUint16BE(buf: number[], offset: number, value: number): void {
  buf[offset] = (value >> 8) & 0xff;
  buf[offset + 1] = value & 0xff;
}

/**
 * Write a 32-bit big-endian value into a buffer.
 */
function writeUint32BE(buf: number[], offset: number, value: number): void {
  buf[offset] = (value >> 24) & 0xff;
  buf[offset + 1] = (value >> 16) & 0xff;
  buf[offset + 2] = (value >> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

interface IFDEntry {
  tag: number;
  type: number; // 1=BYTE, 2=ASCII, 3=SHORT, 4=LONG, 5=RATIONAL, 7=UNDEFINED
  count: number;
  valueOrOffset: number; // inline value (fits in 4 bytes) or offset to data
}

/**
 * Build a minimal TIFF (little-endian) with one IFD.
 *
 * Layout:
 *   [0..1]  byte order: 'II'
 *   [2..3]  magic: 42
 *   [4..7]  IFD0 offset: 8
 *   [8..9]  IFD0 entry count
 *   entries: 12 bytes each
 *   [8 + 2 + entries*12 .. +3]  next IFD offset (0)
 */
function buildTiffLE(entries: IFDEntry[], extraData: number[] = []): Uint8Array {
  const headerSize = 8;
  const ifdCountSize = 2;
  const entrySize = 12;
  const nextIfdSize = 4;
  const ifdOffset = headerSize;
  const totalSize = headerSize + ifdCountSize + entries.length * entrySize + nextIfdSize + extraData.length;

  const buf: number[] = new Array(totalSize).fill(0);

  // Header
  buf[0] = 0x49;
  buf[1] = 0x49; // 'II' little-endian
  writeUint16LE(buf, 2, 42); // magic
  writeUint32LE(buf, 4, ifdOffset); // IFD0 offset

  // Entry count
  writeUint16LE(buf, ifdOffset, entries.length);

  // Entries
  for (let i = 0; i < entries.length; i++) {
    const base = ifdOffset + ifdCountSize + i * entrySize;
    const e = entries[i];
    writeUint16LE(buf, base, e.tag);
    writeUint16LE(buf, base + 2, e.type);
    writeUint32LE(buf, base + 4, e.count);
    writeUint32LE(buf, base + 8, e.valueOrOffset);
  }

  // Next IFD pointer = 0 (no more IFDs)
  const nextIfdOffset = ifdOffset + ifdCountSize + entries.length * entrySize;
  writeUint32LE(buf, nextIfdOffset, 0);

  // Extra data (e.g. GPS IFD, XMP)
  for (let i = 0; i < extraData.length; i++) {
    buf[nextIfdOffset + nextIfdSize + i] = extraData[i];
  }

  return new Uint8Array(buf);
}

/**
 * Build a minimal TIFF (big-endian / Motorola).
 */
function buildTiffBE(entries: IFDEntry[], extraData: number[] = []): Uint8Array {
  const headerSize = 8;
  const ifdCountSize = 2;
  const entrySize = 12;
  const nextIfdSize = 4;
  const ifdOffset = headerSize;
  const totalSize = headerSize + ifdCountSize + entries.length * entrySize + nextIfdSize + extraData.length;

  const buf: number[] = new Array(totalSize).fill(0);

  // Header
  buf[0] = 0x4d;
  buf[1] = 0x4d; // 'MM' big-endian
  writeUint16BE(buf, 2, 42); // magic
  writeUint32BE(buf, 4, ifdOffset); // IFD0 offset

  // Entry count
  writeUint16BE(buf, ifdOffset, entries.length);

  // Entries
  for (let i = 0; i < entries.length; i++) {
    const base = ifdOffset + ifdCountSize + i * entrySize;
    const e = entries[i];
    writeUint16BE(buf, base, e.tag);
    writeUint16BE(buf, base + 2, e.type);
    writeUint32BE(buf, base + 4, e.count);
    writeUint32BE(buf, base + 8, e.valueOrOffset);
  }

  // Next IFD pointer = 0
  const nextIfdOffset = ifdOffset + ifdCountSize + entries.length * entrySize;
  writeUint32BE(buf, nextIfdOffset, 0);

  // Extra data
  for (let i = 0; i < extraData.length; i++) {
    buf[nextIfdOffset + nextIfdSize + i] = extraData[i];
  }

  return new Uint8Array(buf);
}

/**
 * Build a GPS IFD (little-endian) at a given absolute offset.
 * Returns the binary bytes of the GPS IFD only.
 *
 * GPS IFD structure: entry-count(2) + entries(n*12) + nextIFD(4)
 */
function buildGpsIfdLE(entries: IFDEntry[]): number[] {
  const ifdCountSize = 2;
  const entrySize = 12;
  const nextIfdSize = 4;
  const totalSize = ifdCountSize + entries.length * entrySize + nextIfdSize;
  const buf: number[] = new Array(totalSize).fill(0);

  writeUint16LE(buf, 0, entries.length);
  for (let i = 0; i < entries.length; i++) {
    const base = ifdCountSize + i * entrySize;
    const e = entries[i];
    writeUint16LE(buf, base, e.tag);
    writeUint16LE(buf, base + 2, e.type);
    writeUint32LE(buf, base + 4, e.count);
    writeUint32LE(buf, base + 8, e.valueOrOffset);
  }
  writeUint32LE(buf, ifdCountSize + entries.length * entrySize, 0);
  return buf;
}

// TIFF tag constants (matches scanner source)
const TAG_GPS_IFD_POINTER = 0x8825;
const TAG_XMP = 0x02bc;
const TAG_EXIF_IFD_POINTER = 0x8769;
const GPS_TAG_LATITUDE = 0x0002;
const GPS_TAG_LONGITUDE = 0x0004;
const GPS_TAG_ALTITUDE = 0x0006;

describe('TiffScanner.canHandle', () => {
  it('handles tiff', () => {
    expect(scanner.canHandle('tiff')).toBe(true);
  });

  it('rejects other types', () => {
    expect(scanner.canHandle('png')).toBe(false);
    expect(scanner.canHandle('pdf')).toBe(false);
    expect(scanner.canHandle('mp4')).toBe(false);
  });
});

describe('TiffScanner.scan — clean files', () => {
  it('returns no dangerous content for a minimal little-endian TIFF with no special tags', () => {
    // ImageWidth tag (0x0100), type SHORT(3), count 1, value 640
    const data = buildTiffLE([{ tag: 0x0100, type: 3, count: 1, valueOrOffset: 640 }]);
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(false);
    expect(result.foundTypes).toEqual([]);
  });

  it('returns no dangerous content for a minimal big-endian TIFF with no special tags', () => {
    const data = buildTiffBE([{ tag: 0x0100, type: 3, count: 1, valueOrOffset: 640 }]);
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(false);
    expect(result.foundTypes).toEqual([]);
  });

  it('handles a TIFF with no IFD entries', () => {
    const data = buildTiffLE([]);
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });
});

describe('TiffScanner.scan — byte order switching (II vs MM)', () => {
  it('correctly reads little-endian (II) byte order marker', () => {
    const data = buildTiffLE([{ tag: 0x0100, type: 3, count: 1, valueOrOffset: 1 }]);
    // 'II' = 0x49 0x49
    expect(data[0]).toBe(0x49);
    expect(data[1]).toBe(0x49);
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('correctly reads big-endian (MM) byte order marker', () => {
    const data = buildTiffBE([{ tag: 0x0100, type: 3, count: 1, valueOrOffset: 1 }]);
    // 'MM' = 0x4D 0x4D
    expect(data[0]).toBe(0x4d);
    expect(data[1]).toBe(0x4d);
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('returns empty result for invalid byte-order marker', () => {
    const buf = new Uint8Array(16);
    buf[0] = 0x00;
    buf[1] = 0x00; // neither II nor MM
    buf[2] = 0x00;
    buf[3] = 42; // magic (BE)
    buf[4] = 0x00;
    buf[5] = 0x00;
    buf[6] = 0x00;
    buf[7] = 8; // IFD at 8
    const result = scanner.scan(buf, 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('returns empty result when magic number is not 42', () => {
    const buf = new Uint8Array(16);
    buf[0] = 0x49;
    buf[1] = 0x49; // II
    writeUint16LE([...buf], 2, 99); // magic=99, not 42
    // We can't easily patch the Uint8Array view — build from scratch:
    const arr: number[] = new Array(16).fill(0);
    arr[0] = 0x49;
    arr[1] = 0x49;
    writeUint16LE(arr, 2, 99);
    writeUint32LE(arr, 4, 8);
    const result = scanner.scan(new Uint8Array(arr), 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });
});

describe('TiffScanner.scan — GPS IFD', () => {
  it('detects GPS latitude tag via GPS IFD pointer (little-endian)', () => {
    // GPS IFD will be placed right after the main IFD
    // Main IFD: header(8) + count(2) + 1 entry(12) + nextIFD(4) = 26 bytes
    // GPS IFD starts at offset 26
    const gpsIfdOffset = 26;
    const gpsIfd = buildGpsIfdLE([
      { tag: GPS_TAG_LATITUDE, type: 5, count: 3, valueOrOffset: 0 }, // RATIONAL
    ]);
    const data = buildTiffLE(
      [{ tag: TAG_GPS_IFD_POINTER, type: 4, count: 1, valueOrOffset: gpsIfdOffset }],
      gpsIfd,
    );
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.foundTypes).toContain('location_metadata');
    expect(result.details.some(d => d.includes('Latitude'))).toBe(true);
  });

  it('detects GPS longitude tag via GPS IFD pointer', () => {
    const gpsIfdOffset = 26;
    const gpsIfd = buildGpsIfdLE([
      { tag: GPS_TAG_LONGITUDE, type: 5, count: 3, valueOrOffset: 0 },
    ]);
    const data = buildTiffLE(
      [{ tag: TAG_GPS_IFD_POINTER, type: 4, count: 1, valueOrOffset: gpsIfdOffset }],
      gpsIfd,
    );
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.details.some(d => d.includes('Longitude'))).toBe(true);
  });

  it('detects GPS altitude tag via GPS IFD pointer', () => {
    const gpsIfdOffset = 26;
    const gpsIfd = buildGpsIfdLE([
      { tag: GPS_TAG_ALTITUDE, type: 5, count: 1, valueOrOffset: 0 },
    ]);
    const data = buildTiffLE(
      [{ tag: TAG_GPS_IFD_POINTER, type: 4, count: 1, valueOrOffset: gpsIfdOffset }],
      gpsIfd,
    );
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.details.some(d => d.includes('Altitude'))).toBe(true);
  });

  it('does not flag a GPS IFD pointer that points to a GPS IFD with no coordinate tags', () => {
    // GPS IFD with only a non-coordinate tag (GPS_STATUS = 0x0009)
    const gpsIfdOffset = 26;
    const gpsIfd = buildGpsIfdLE([
      { tag: 0x0009, type: 2, count: 1, valueOrOffset: 0x41000000 }, // 'A' = Active
    ]);
    const data = buildTiffLE(
      [{ tag: TAG_GPS_IFD_POINTER, type: 4, count: 1, valueOrOffset: gpsIfdOffset }],
      gpsIfd,
    );
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });
});

describe('TiffScanner.scan — XMP tag', () => {
  it('detects GPSLatitude in XMP data at tag 0x02BC', () => {
    // XMP data goes after main IFD
    // Main IFD: 8 + 2 + 1*12 + 4 = 26 bytes → XMP data at offset 26
    const xmpText = '<x:xmpmeta><exif:GPSLatitude>52.37</exif:GPSLatitude></x:xmpmeta>';
    const xmpBytes = [...xmpText].map(c => c.charCodeAt(0));
    const xmpOffset = 26;
    const data = buildTiffLE(
      [{ tag: TAG_XMP, type: 7, count: xmpBytes.length, valueOrOffset: xmpOffset }],
      xmpBytes,
    );
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.foundTypes).toContain('location_metadata');
  });

  it('detects face recognition data in XMP at tag 0x02BC', () => {
    const xmpText = '<x:xmpmeta><mwg-rs:Regions><mwg-rs:RegionList/></mwg-rs:Regions></x:xmpmeta>';
    const xmpBytes = [...xmpText].map(c => c.charCodeAt(0));
    const xmpOffset = 26;
    const data = buildTiffLE(
      [{ tag: TAG_XMP, type: 7, count: xmpBytes.length, valueOrOffset: xmpOffset }],
      xmpBytes,
    );
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('facial_recognition');
  });

  it('does not flag benign XMP data', () => {
    const xmpText = '<x:xmpmeta><dc:title>My Photo</dc:title></x:xmpmeta>';
    const xmpBytes = [...xmpText].map(c => c.charCodeAt(0));
    const xmpOffset = 26;
    const data = buildTiffLE(
      [{ tag: TAG_XMP, type: 7, count: xmpBytes.length, valueOrOffset: xmpOffset }],
      xmpBytes,
    );
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });
});

describe('TiffScanner.scan — truncated / corrupt file', () => {
  it('returns empty result for data shorter than 8 bytes', () => {
    expect(scanner.scan(new Uint8Array(0), 'tiff').hasDangerousContent).toBe(false);
    expect(scanner.scan(new Uint8Array(7), 'tiff').hasDangerousContent).toBe(false);
  });

  it('does not throw when IFD offset is beyond file bounds', () => {
    // Build a TIFF header pointing to an IFD at offset 9999
    const arr: number[] = new Array(8).fill(0);
    arr[0] = 0x49;
    arr[1] = 0x49;
    writeUint16LE(arr, 2, 42);
    writeUint32LE(arr, 4, 9999); // IFD way out of bounds
    expect(() => scanner.scan(new Uint8Array(arr), 'tiff')).not.toThrow();
    const result = scanner.scan(new Uint8Array(arr), 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('does not throw on truncated IFD (entry count present but entries cut short)', () => {
    // Build a TIFF with IFD count=5 but only 1 entry's bytes present
    const arr: number[] = new Array(8 + 2 + 12).fill(0);
    arr[0] = 0x49;
    arr[1] = 0x49;
    writeUint16LE(arr, 2, 42);
    writeUint32LE(arr, 4, 8); // IFD at offset 8
    writeUint16LE(arr, 8, 5); // 5 entries claimed, only 1 fits
    // One valid entry: ImageWidth tag
    writeUint16LE(arr, 10, 0x0100); // tag
    writeUint16LE(arr, 12, 3); // type SHORT
    writeUint32LE(arr, 14, 1); // count
    writeUint32LE(arr, 18, 640); // value
    expect(() => scanner.scan(new Uint8Array(arr), 'tiff')).not.toThrow();
    const result = scanner.scan(new Uint8Array(arr), 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('does not throw when GPS IFD pointer references out-of-bounds offset', () => {
    const data = buildTiffLE([
      { tag: TAG_GPS_IFD_POINTER, type: 4, count: 1, valueOrOffset: 99999 },
    ]);
    expect(() => scanner.scan(data, 'tiff')).not.toThrow();
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });
});

describe('TiffScanner.scan — anomalous / private tags', () => {
  it('ignores unknown/private tags without throwing', () => {
    // Private/custom tags typically use high tag numbers (e.g. 0xC612..0xFFFF)
    const privateTag1 = { tag: 0xC612, type: 3, count: 1, valueOrOffset: 0 };
    const privateTag2 = { tag: 0xEA1C, type: 7, count: 4, valueOrOffset: 0 };
    const data = buildTiffLE([privateTag1, privateTag2]);
    expect(() => scanner.scan(data, 'tiff')).not.toThrow();
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('handles multiple standard tags alongside GPS pointer without confusion', () => {
    // Main IFD: header(8) + count(2) + 3 entries(36) + nextIFD(4) = 50 bytes
    const gpsIfdOffset = 50;
    const gpsIfd = buildGpsIfdLE([
      { tag: GPS_TAG_LATITUDE, type: 5, count: 3, valueOrOffset: 0 },
      { tag: GPS_TAG_LONGITUDE, type: 5, count: 3, valueOrOffset: 0 },
    ]);
    const data = buildTiffLE(
      [
        { tag: 0x0100, type: 3, count: 1, valueOrOffset: 640 }, // ImageWidth
        { tag: 0x0101, type: 3, count: 1, valueOrOffset: 480 }, // ImageLength
        { tag: TAG_GPS_IFD_POINTER, type: 4, count: 1, valueOrOffset: gpsIfdOffset },
      ],
      gpsIfd,
    );
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.foundTypes).toContain('location_metadata');
  });
});
