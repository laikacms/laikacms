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

/** Build a minimal valid GIF89a with the given content blocks (between header+screen descriptor and trailer). */
function buildGif(contentBlocks: number[][] = []): Uint8Array {
  const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
  // Logical screen descriptor: 1x1, no global color table, packed=0
  const screenDescriptor = [0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00];
  const trailer = [0x3b];
  return new Uint8Array([...header, ...screenDescriptor, ...contentBlocks.flat(), ...trailer]);
}

/** Build a minimal Comment Extension block: 0x21 0xFE <sub-blocks> 0x00. */
function gifCommentExtension(text: string): number[] {
  const bytes = [...text].map(c => c.charCodeAt(0));
  return [0x21, 0xfe, bytes.length, ...bytes, 0x00];
}

/** Build a minimal Application Extension block (e.g. NETSCAPE2.0). */
function gifApplicationExtension(name: string, data: number[]): number[] {
  const nameBytes = [...name].map(c => c.charCodeAt(0));
  return [0x21, 0xff, nameBytes.length, ...nameBytes, data.length, ...data, 0x00];
}

/** Build a WebP RIFF chunk with the given FourCC and payload (auto-padded to even). */
function webpChunk(fourCC: string, payload: number[]): number[] {
  const fourCCBytes = [...fourCC].map(c => c.charCodeAt(0));
  const size = payload.length;
  const sizeLE = [size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff];
  const padding = size % 2 === 0 ? [] : [0];
  return [...fourCCBytes, ...sizeLE, ...payload, ...padding];
}

/** Build a minimal valid WebP file containing the given chunks. */
function buildWebp(chunks: number[][]): Uint8Array {
  const flat = chunks.flat();
  const fileSize = 4 + flat.length; // "WEBP" + chunks
  const sizeLE = [fileSize & 0xff, (fileSize >> 8) & 0xff, (fileSize >> 16) & 0xff, (fileSize >> 24) & 0xff];
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46, // "RIFF"
    ...sizeLE,
    0x57,
    0x45,
    0x42,
    0x50, // "WEBP"
    ...flat,
  ]);
}

/** Build a minimal JPEG with the given pre-SOS segments and optional post-SOS bytes. */
function buildJpeg(
  segments: { marker: number, payload: number[] }[],
  postSos: number[] = [],
): Uint8Array {
  const out: number[] = [0xff, 0xd8]; // SOI
  for (const { marker, payload } of segments) {
    const len = payload.length + 2;
    out.push(0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload);
  }
  // SOS segment with a small payload (length = 8 -> 6 bytes of body) so the
  // total file length stays above the 12-byte detect threshold.
  out.push(0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0);
  out.push(...postSos);
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
  it('strips a tEXt chunk that contains GPS metadata', async () => {
    const tEXt = pngChunk(
      'tEXt',
      [...'Comment'].map(c => c.charCodeAt(0)).concat(0, ...[...'GPSLatitude=1.234'].map(c => c.charCodeAt(0))),
    );
    const png = buildPng([tEXt]);
    const result = await sanitizeFile(png);
    expect(result.fileType).toBe('png');
    expect(result.ignored).toBe(false);
    expect(result.strippedMetadata.hadTextMetadata).toBe(true);
    expect(result.strippedMetadata.strippedChunks).toContain('tEXt');
    expect(result.data.length).toBeLessThan(png.length);
  });

  it('preserves a benign tEXt chunk (e.g. tool attribution)', async () => {
    const tEXt = pngChunk(
      'tEXt',
      [...'Software'].map(c => c.charCodeAt(0)).concat(0, ...[...'Made with Pixelmator Pro'].map(c => c.charCodeAt(0))),
    );
    const png = buildPng([tEXt]);
    const result = await sanitizeFile(png);
    expect(result.data).toBe(png);
    expect(result.strippedMetadata.strippedChunks).toEqual([]);
  });

  it('strips an iTXt chunk that contains face-recognition metadata', async () => {
    const iTXt = pngChunk(
      'iTXt',
      [...'XML:com.adobe.xmp'].map(c => c.charCodeAt(0)).concat(
        0,
        0,
        0,
        0,
        0,
        ...[...'<mwg-rs:Regions/>'].map(c => c.charCodeAt(0)),
      ),
    );
    const png = buildPng([iTXt]);
    const result = await sanitizeFile(png);
    expect(result.strippedMetadata.strippedChunks).toContain('iTXt');
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

  it('returns the original bytes verbatim when there is nothing to strip', async () => {
    const png = buildPng();
    const result = await sanitizeFile(png);
    // Same reference — no allocation, no rewrite.
    expect(result.data).toBe(png);
  });

  it('preserves an unknown ancillary chunk byte-for-byte while stripping tEXt', async () => {
    const tEXt = pngChunk(
      'tEXt',
      [...'Comment'].map(c => c.charCodeAt(0)).concat(0, ...[...'GPSLatitude=1.234'].map(c => c.charCodeAt(0))),
    );
    // "prVt" (private ancillary chunk, lowercase first letter = ancillary, lowercase third = unknown vendor)
    const prVt = pngChunk('prVt', [0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);
    const png = buildPng([tEXt, prVt]);
    const result = await sanitizeFile(png);
    // The unknown chunk should still be in the output, untouched.
    const prVtIndex = png.indexOf(0x70); // 'p'
    expect(result.strippedMetadata.strippedChunks).toEqual(['tEXt']);
    expect(prVtIndex).toBeGreaterThan(-1);
    const outStr = Array.from(result.data);
    const pIdx = outStr.findIndex((b, i) =>
      b === 0x70 && outStr[i + 1] === 0x72 && outStr[i + 2] === 0x56 && outStr[i + 3] === 0x74
    );
    expect(pIdx).toBeGreaterThan(-1);
    // Bytes after the type — payload + CRC — match the input verbatim.
    const prVtLen = 6;
    for (let i = 0; i < 4 + prVtLen + 4; i++) {
      expect(result.data[pIdx - 4 + i]).toBe(png[prVtIndex - 4 + i]);
    }
  });
});

describe('sanitizeFile (GIF)', () => {
  it('strips a Comment Extension that contains GPS metadata', async () => {
    const gif = buildGif([gifCommentExtension('GPSLatitude=37.4N,GPSLongitude=122.1W')]);
    const result = await sanitizeFile(gif);
    expect(result.fileType).toBe('gif');
    expect(result.strippedMetadata.hadTextMetadata).toBe(true);
    expect(result.strippedMetadata.strippedChunks).toContain('Comment');
    expect(result.data.length).toBeLessThan(gif.length);
  });

  it('preserves a benign Comment Extension (e.g. tool signature)', async () => {
    const gif = buildGif([gifCommentExtension('Made with GIMP')]);
    const result = await sanitizeFile(gif);
    expect(result.data).toBe(gif);
    expect(result.strippedMetadata.strippedChunks).toEqual([]);
  });

  it('preserves a benign Comment Extension that just carries a caption', async () => {
    const gif = buildGif([gifCommentExtension('A funny dancing cat animation, 2024 edition')]);
    const result = await sanitizeFile(gif);
    expect(result.data).toBe(gif);
  });

  it('returns the original bytes verbatim when no comment/plain-text extensions are present', async () => {
    const gif = buildGif([gifApplicationExtension('NETSCAPE2.0', [0x01, 0x00, 0x00])]);
    const result = await sanitizeFile(gif);
    expect(result.data).toBe(gif);
    expect(result.strippedMetadata.strippedChunks).toEqual([]);
  });

  it('preserves an Application Extension byte-for-byte while stripping a dangerous Comment', async () => {
    const netscape = gifApplicationExtension('NETSCAPE2.0', [0x01, 0x00, 0x00]);
    const comment = gifCommentExtension('FaceRegion=person:Alice');
    const gif = buildGif([netscape, comment]);
    const result = await sanitizeFile(gif);
    expect(result.strippedMetadata.strippedChunks).toEqual(['Comment']);
    // Application extension fingerprint (NETSCAPE) must survive untouched.
    const outStr = String.fromCharCode(...result.data);
    expect(outStr).toContain('NETSCAPE2.0');
  });

  it('throws on an invalid GIF signature', async () => {
    await expect(sanitizeFile(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).rejects.toThrow();
  });
});

describe('sanitizeFile (WebP)', () => {
  it('strips an EXIF chunk and flags timestamps + text metadata', async () => {
    const vp8 = webpChunk('VP8 ', new Array(16).fill(0));
    const exif = webpChunk('EXIF', [...'EXIF metadata'].map(c => c.charCodeAt(0)));
    const webp = buildWebp([vp8, exif]);
    const result = await sanitizeFile(webp);
    expect(result.fileType).toBe('webp');
    expect(result.strippedMetadata.hadTextMetadata).toBe(true);
    expect(result.strippedMetadata.hadTimestamps).toBe(true);
    expect(result.strippedMetadata.strippedChunks).toContain('EXIF');
    expect(result.data.length).toBeLessThan(webp.length);
  });

  it('returns the original bytes verbatim when no EXIF/XMP chunks are present', async () => {
    const vp8 = webpChunk('VP8 ', new Array(16).fill(0));
    const iccp = webpChunk('ICCP', [...'fake icc'].map(c => c.charCodeAt(0)));
    const webp = buildWebp([vp8, iccp]);
    const result = await sanitizeFile(webp);
    expect(result.data).toBe(webp);
    expect(result.strippedMetadata.strippedChunks).toEqual([]);
  });

  it('clears VP8X EXIF/XMP flag bits only for the chunks actually stripped', async () => {
    // VP8X header: flags(1) + reserved(3) + canvasW-1(3) + canvasH-1(3) = 10 bytes
    // Set EXIF (bit 3 = 0x08) and XMP (bit 2 = 0x04) bits.
    const vp8x = webpChunk('VP8X', [
      0x0c, // flags: EXIF + XMP set
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    const vp8 = webpChunk('VP8 ', new Array(16).fill(0));
    const exif = webpChunk('EXIF', [0xaa, 0xbb]);
    // Note: NO XMP chunk in this file, just the VP8X flag claiming it.
    const webp = buildWebp([vp8x, vp8, exif]);
    const result = await sanitizeFile(webp);
    // VP8X is at offset 12. Flags byte at offset 12 + 8 = 20.
    expect(result.data[20]).toBe(0x04); // EXIF bit cleared, XMP bit left alone
    expect(result.strippedMetadata.strippedChunks).toEqual(['EXIF']);
  });

  it('updates the RIFF size header after stripping', async () => {
    const vp8 = webpChunk('VP8 ', new Array(16).fill(0));
    const exif = webpChunk('EXIF', [...'metadata'].map(c => c.charCodeAt(0)));
    const webp = buildWebp([vp8, exif]);
    const result = await sanitizeFile(webp);
    // RIFF size at bytes 4..7 (little-endian) = output.length - 8
    const recordedSize = result.data[4] | (result.data[5] << 8) | (result.data[6] << 16) | (result.data[7] << 24);
    expect(recordedSize).toBe(result.data.length - 8);
  });

  it('throws on an invalid WebP signature', async () => {
    await expect(sanitizeFile(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).rejects.toThrow();
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

  it('strips a COM segment that contains GPS metadata', async () => {
    const payload = [...'GPSLatitude=37.4'].map(c => c.charCodeAt(0));
    const jpeg = buildJpeg([{ marker: 0xfe, payload }]);
    const result = await sanitizeFile(jpeg);
    expect(result.strippedMetadata.strippedChunks).toContain('COM');
  });

  it('preserves a benign COM segment (e.g. tool signature)', async () => {
    const payload = [...'Made with Pixelmator Pro'].map(c => c.charCodeAt(0));
    const jpeg = buildJpeg([{ marker: 0xfe, payload }]);
    const result = await sanitizeFile(jpeg);
    expect(result.data).toBe(jpeg);
    expect(result.strippedMetadata.strippedChunks).toBeUndefined();
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

  it('returns the original bytes verbatim when there is nothing to strip', async () => {
    const jfif = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0, 0x48, 0, 0x48, 0, 0];
    const jpeg = buildJpeg([{ marker: 0xe0, payload: jfif }]);
    const result = await sanitizeFile(jpeg);
    // Same reference — we did not allocate or rewrite anything.
    expect(result.data).toBe(jpeg);
  });

  it('preserves entropy-coded scan data containing extra markers (progressive JPEGs)', async () => {
    // Simulate a progressive JPEG: bytes after SOS that include a DHT marker
    // (0xff 0xc4) followed by another SOS segment. The previous sanitizer
    // would `break` at the DHT and truncate everything after it.
    const progressiveTail = [
      0x12,
      0x34,
      0x56, // first scan entropy data
      0xff,
      0x00, // escaped 0xff inside entropy data
      0xff,
      0xd0, // RST0 marker
      0x78,
      0x9a,
      0xff,
      0xc4,
      0x00,
      0x06,
      0x11,
      0x22,
      0x33,
      0x44, // DHT segment (length=6)
      0xff,
      0xda,
      0x00,
      0x08,
      0,
      0,
      0,
      0,
      0,
      0, // second SOS (progressive scan)
      0xbc,
      0xde,
      0xf0, // second scan entropy data
    ];
    const jpeg = buildJpeg([], progressiveTail);
    const result = await sanitizeFile(jpeg);
    expect(result.data).toEqual(jpeg);
  });

  it('strips APP1 surgically while preserving everything else byte-for-byte', async () => {
    const exifPayload = [...'Exif\0\0', 0xaa, 0xbb, 0xcc, 0xdd].map(v => typeof v === 'string' ? v.charCodeAt(0) : v);
    const jfif = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0, 0x48, 0, 0x48, 0, 0];
    const tail = [0x12, 0x34, 0xff, 0x00, 0xff, 0xd0, 0x56, 0x78];
    const jpeg = buildJpeg(
      [{ marker: 0xe0, payload: jfif }, { marker: 0xe1, payload: exifPayload }],
      tail,
    );
    // Find the APP1 segment boundaries in the input.
    const app1Start = 2 /* SOI */ + 4 + jfif.length; // after SOI + APP0 (FF E0 + len + payload)
    const app1Length = exifPayload.length + 2;
    const app1End = app1Start + 2 + app1Length;

    const result = await sanitizeFile(jpeg);
    // Output = bytes before APP1 + bytes after APP1, untouched.
    const expected = new Uint8Array(jpeg.length - (app1End - app1Start));
    expected.set(jpeg.subarray(0, app1Start), 0);
    expected.set(jpeg.subarray(app1End), app1Start);
    expect(result.data).toEqual(expected);
    expect(result.strippedMetadata.strippedChunks).toEqual(['APP1']);
  });

  it('preserves fill bytes between segments', async () => {
    // Hand-build a JPEG with fill 0xff bytes before APP0 and before SOS.
    const jpeg = new Uint8Array([
      0xff,
      0xd8, // SOI
      0xff,
      0xff,
      0xff,
      0xe0,
      0x00,
      0x07,
      0x4a,
      0x46,
      0x49,
      0x46,
      0x00, // fill + APP0/JFIF (truncated)
      0xff,
      0xff,
      0xda,
      0x00,
      0x08,
      0,
      0,
      0,
      0,
      0,
      0, // fill + SOS
      0xff,
      0xd9, // EOI
    ]);
    const result = await sanitizeFile(jpeg);
    // Nothing dangerous → original returned.
    expect(result.data).toBe(jpeg);
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
