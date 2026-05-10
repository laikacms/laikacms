import { describe, expect, it } from 'vitest';
import { extNameToMimeType, mimeTypeMapper } from './mime-type.js';

describe('extNameToMimeType', () => {
  it('maps known image extensions to canonical MIME types', () => {
    expect(extNameToMimeType('.jpg')).toBe('image/jpeg');
    expect(extNameToMimeType('.jpeg')).toBe('image/jpeg');
    expect(extNameToMimeType('.png')).toBe('image/png');
    expect(extNameToMimeType('.svg')).toBe('image/svg+xml');
  });

  it('maps text and code extensions correctly', () => {
    expect(extNameToMimeType('.json')).toBe('application/json');
    expect(extNameToMimeType('.md')).toBe('text/markdown');
    expect(extNameToMimeType('.markdown')).toBe('text/markdown');
    expect(extNameToMimeType('.ts')).toBe('application/typescript');
    expect(extNameToMimeType('.html')).toBe('text/html');
  });

  it('falls back to application/octet-stream for unknown extensions', () => {
    expect(extNameToMimeType('.unknownext')).toBe('application/octet-stream');
    expect(extNameToMimeType('')).toBe('application/octet-stream');
    expect(extNameToMimeType('jpg')).toBe('application/octet-stream'); // missing leading dot
  });

  it('mimeTypeMapper covers every supported extension with a non-empty value', () => {
    for (const [ext, mime] of Object.entries(mimeTypeMapper)) {
      expect(typeof mime).toBe('string');
      expect(mime.length).toBeGreaterThan(0);
      expect(extNameToMimeType(ext)).toBe(mime);
    }
  });
});
