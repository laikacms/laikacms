import { describe, expect, it } from 'vitest';
import { canSanitize, getSupportedFileTypes, sanitizeFile } from './sanitizer.js';
import { isSanitizableFileType } from './types.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(data: Uint8Array): number {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pngChunk(type: string, data: number[]): number[] {
  const typeBytes = [...type].map(c => c.charCodeAt(0));
  const payload = new Uint8Array([...typeBytes, ...data]);
  const crc = crc32(payload);
  return [...be32(data.length), ...typeBytes, ...data, ...be32(crc)];
}

/** Build a minimal valid PNG with optional extra chunks before IEND. */
function buildPng(extraChunks: number[][] = []): Uint8Array {
  // IHDR for a 1x1 RGBA image
  const ihdr = pngChunk('IHDR', [
    0,
    0,
    0,
    1, // width
    0,
    0,
    0,
    1, // height
    8, // bit depth
    6, // color type (RGBA)
    0, // compression
    0, // filter
    0, // interlace
  ]);
  // IDAT with arbitrary bytes (we don't actually decode it)
  const idat = pngChunk('IDAT', [0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff]);
  const iend = pngChunk('IEND', []);
  return new Uint8Array([
    ...PNG_SIGNATURE,
    ...ihdr,
    ...extraChunks.flat(),
    ...idat,
    ...iend,
  ]);
}

/** Build a minimal JPEG with the given pre-SOS segments. */
function buildJpeg(segments: { marker: number, payload: number[] }[]): Uint8Array {
  const out: number[] = [0xff, 0xd8]; // SOI
  for (const { marker, payload } of segments) {
    const len = payload.length + 2;
    out.push(0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload);
  }
  // SOS segment with a small payload (length = 8 -> 6 bytes of body) so the
  // total file length stays above the 12-byte detect threshold.
  out.push(0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0);
  out.push(0xff, 0xd9); // EOI
  return new Uint8Array(out);
}

describe('canSanitize', () => {
  it('approves PNG data', () => {
    const result = canSanitize(buildPng());
    expect(result.canSanitize).toBe(true);
    expect(result.detectedType).toBe('png');
  });

  it('rejects PDF with a reason', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0]);
    const result = canSanitize(pdf);
    expect(result.canSanitize).toBe(false);
    expect(result.detectedType).toBe('pdf');
    expect(result.reason).toMatch(/not supported/);
  });
});

describe('getSupportedFileTypes', () => {
  it('exposes exactly the four sanitizable formats', () => {
    expect(getSupportedFileTypes()).toEqual(['png', 'gif', 'webp', 'jpeg']);
  });
});

describe('isSanitizableFileType', () => {
  it('narrows the union to sanitizable types', () => {
    expect(isSanitizableFileType('png')).toBe(true);
    expect(isSanitizableFileType('jpeg')).toBe(true);
    expect(isSanitizableFileType('pdf')).toBe(false);
    expect(isSanitizableFileType('unknown')).toBe(false);
  });
});

describe('sanitizeFile (PNG)', () => {
  it('strips a tEXt chunk and reports it', async () => {
    const tEXt = pngChunk('tEXt', [...'Comment'].map(c => c.charCodeAt(0)).concat(0, 0x68, 0x69));
    const png = buildPng([tEXt]);
    const result = await sanitizeFile(png);
    expect(result.fileType).toBe('png');
    expect(result.ignored).toBe(false);
    expect(result.strippedMetadata.hadTextMetadata).toBe(true);
    expect(result.strippedMetadata.strippedChunks).toContain('tEXt');
    expect(result.data.length).toBeLessThan(png.length);
  });

  it('strips a tIME chunk and flags hadTimestamps', async () => {
    const tIME = pngChunk('tIME', [0x07, 0xe6, 1, 1, 0, 0, 0]);
    const png = buildPng([tIME]);
    const result = await sanitizeFile(png);
    expect(result.strippedMetadata.hadTimestamps).toBe(true);
    expect(result.strippedMetadata.strippedChunks).toContain('tIME');
  });

  it('passes through a PNG with no metadata chunks', async () => {
    const png = buildPng();
    const result = await sanitizeFile(png);
    expect(result.fileType).toBe('png');
    expect(result.data.length).toBe(png.length);
    expect(result.strippedMetadata.hadTextMetadata).toBe(false);
    expect(result.strippedMetadata.strippedChunks).toEqual([]);
  });

  it('throws on a corrupted PNG (bad CRC)', async () => {
    const png = buildPng();
    const broken = new Uint8Array(png);
    broken[broken.length - 1] ^= 0xff; // flip a byte in the IEND CRC
    await expect(sanitizeFile(broken)).rejects.toThrow();
  });
});

describe('sanitizeFile (JPEG)', () => {
  it('strips an APP1 (EXIF) segment and flags timestamps + text metadata', async () => {
    const exifPayload = [...'Exif\0\0', 0xaa, 0xbb, 0xcc].map(v => typeof v === 'string' ? v.charCodeAt(0) : v);
    const jpeg = buildJpeg([{ marker: 0xe1, payload: exifPayload }]);
    const result = await sanitizeFile(jpeg);
    expect(result.fileType).toBe('jpeg');
    expect(result.strippedMetadata.hadTextMetadata).toBe(true);
    expect(result.strippedMetadata.hadTimestamps).toBe(true);
    expect(result.strippedMetadata.strippedChunks).toContain('APP1');
  });

  it('strips a comment (COM) segment', async () => {
    const jpeg = buildJpeg([{ marker: 0xfe, payload: [0x68, 0x69] }]);
    const result = await sanitizeFile(jpeg);
    expect(result.strippedMetadata.strippedChunks).toContain('COM');
  });

  it('preserves an APP0/JFIF segment', async () => {
    // APP0 ("JFIF\0" + version 1.1 + units + xdens + ydens + thumb wh)
    const jfif = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0, 0x48, 0, 0x48, 0, 0];
    const jpeg = buildJpeg([{ marker: 0xe0, payload: jfif }]);
    const result = await sanitizeFile(jpeg);
    // APP0 is not in the strip list — output should still contain JFIF magic.
    const outStr = String.fromCharCode(...result.data);
    expect(outStr).toContain('JFIF');
    expect(result.strippedMetadata.strippedChunks).toBeUndefined();
  });

  it('throws on a missing SOI marker', async () => {
    await expect(sanitizeFile(new Uint8Array([0x00, 0x00, 0xff, 0xd9]))).rejects.toThrow();
  });
});

describe('sanitizeFile (options)', () => {
  it('rejects files larger than maxFileSize', async () => {
    const png = buildPng();
    await expect(sanitizeFile(png, { maxFileSize: 4 })).rejects.toThrow(/exceeds maximum/);
  });

  it('passes through ignored extensions unchanged', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0, 0]);
    const result = await sanitizeFile(pdf, { ignoreExtensions: ['pdf'] });
    expect(result.ignored).toBe(true);
    expect(result.fileType).toBe('ignored');
    expect(result.data).toBe(pdf);
  });

  it('throws UnsupportedFileTypeError when expectedMimeType disagrees with detected', async () => {
    const png = buildPng();
    await expect(sanitizeFile(png, {}, 'image/jpeg')).rejects.toThrow(/MIME type/);
  });

  it('accepts image/jpg as a synonym for image/jpeg when detected type matches', async () => {
    const jpeg = buildJpeg([]);
    const result = await sanitizeFile(jpeg, {}, 'image/jpg');
    expect(result.fileType).toBe('jpeg');
  });

  it('rejects an unsupported file type with no dangerous content', async () => {
    // Plain "%PDF-" header followed by zeros: no dangerous markers found.
    const pdf = new Uint8Array(32);
    pdf.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await expect(sanitizeFile(pdf)).rejects.toThrow(/not supported/);
  });
});
