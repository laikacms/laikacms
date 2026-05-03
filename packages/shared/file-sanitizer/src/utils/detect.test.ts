import { describe, expect, it } from 'vitest';
import { detectFileType, getMimeType } from './detect.js';

function pad(bytes: number[], length = 16): Uint8Array {
  const out = new Uint8Array(length);
  out.set(bytes);
  return out;
}

describe('detectFileType', () => {
  it('returns "unknown" for inputs shorter than 12 bytes', () => {
    expect(detectFileType(new Uint8Array([0x89, 0x50, 0x4e]))).toBe('unknown');
  });

  it('detects PNG via the 8-byte signature', () => {
    expect(detectFileType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
  });

  it('detects GIF87a and GIF89a', () => {
    expect(detectFileType(pad([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))).toBe('gif');
    expect(detectFileType(pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('gif');
  });

  it('detects WebP (RIFF + WEBP)', () => {
    const data = pad([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0,
      0,
      0,
      0, // size (don't care)
      0x57,
      0x45,
      0x42,
      0x50, // WEBP
    ]);
    expect(detectFileType(data)).toBe('webp');
  });

  it('detects AVI (RIFF + AVI<space>)', () => {
    const data = pad([
      0x52,
      0x49,
      0x46,
      0x46,
      0,
      0,
      0,
      0,
      0x41,
      0x56,
      0x49,
      0x20,
    ]);
    expect(detectFileType(data)).toBe('avi');
  });

  it('detects JPEG via FFD8FF', () => {
    expect(detectFileType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
  });

  it('detects TIFF (both endians)', () => {
    expect(detectFileType(pad([0x49, 0x49, 0x2a, 0x00]))).toBe('tiff');
    expect(detectFileType(pad([0x4d, 0x4d, 0x00, 0x2a]))).toBe('tiff');
  });

  it('detects PDF', () => {
    expect(detectFileType(pad([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('pdf');
  });

  it('detects HEIC via ftyp brand', () => {
    const data = pad([
      0,
      0,
      0,
      0x10, // box size
      0x66,
      0x74,
      0x79,
      0x70, // ftyp
      0x68,
      0x65,
      0x69,
      0x63, // "heic"
    ]);
    expect(detectFileType(data)).toBe('heic');
  });

  it('detects MP4 via ftyp brand', () => {
    const data = pad([
      0,
      0,
      0,
      0x10,
      0x66,
      0x74,
      0x79,
      0x70,
      0x69,
      0x73,
      0x6f,
      0x6d, // "isom"
    ]);
    expect(detectFileType(data)).toBe('mp4');
  });

  it('detects MOV via ftyp brand', () => {
    const data = pad([
      0,
      0,
      0,
      0x10,
      0x66,
      0x74,
      0x79,
      0x70,
      0x71,
      0x74,
      0x20,
      0x20, // "qt  "
    ]);
    expect(detectFileType(data)).toBe('mov');
  });

  it('returns "unknown" for plain RIFF without WEBP/AVI', () => {
    const data = pad([
      0x52,
      0x49,
      0x46,
      0x46,
      0,
      0,
      0,
      0,
      0x57,
      0x41,
      0x56,
      0x45, // "WAVE"
    ]);
    expect(detectFileType(data)).toBe('unknown');
  });

  it('returns "unknown" for arbitrary bytes', () => {
    expect(detectFileType(pad([0xaa, 0xbb, 0xcc, 0xdd]))).toBe('unknown');
  });
});

describe('getMimeType', () => {
  it('returns canonical MIME types for sanitizable formats', () => {
    expect(getMimeType('png')).toBe('image/png');
    expect(getMimeType('gif')).toBe('image/gif');
    expect(getMimeType('webp')).toBe('image/webp');
    expect(getMimeType('jpeg')).toBe('image/jpeg');
  });

  it('returns canonical MIME types for unsupported formats', () => {
    expect(getMimeType('tiff')).toBe('image/tiff');
    expect(getMimeType('pdf')).toBe('application/pdf');
    expect(getMimeType('mp4')).toBe('video/mp4');
    expect(getMimeType('mov')).toBe('video/quicktime');
  });

  it('falls back to application/octet-stream for unknown', () => {
    expect(getMimeType('unknown')).toBe('application/octet-stream');
  });
});
