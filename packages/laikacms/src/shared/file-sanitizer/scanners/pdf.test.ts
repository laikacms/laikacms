import { describe, expect, it } from 'vitest';
import { PdfScanner } from './pdf.js';

const scanner = new PdfScanner();

/**
 * Encode string to byte array.
 */
function str(s: string): number[] {
  return [...s].map(c => c.charCodeAt(0));
}

/**
 * Build a minimal valid-looking PDF byte array.
 */
function buildPdf(body: string): Uint8Array {
  const content = `%PDF-1.4\n${body}`;
  return new Uint8Array(str(content));
}

describe('PdfScanner.canHandle', () => {
  it('handles pdf', () => {
    expect(scanner.canHandle('pdf')).toBe(true);
  });

  it('rejects other types', () => {
    expect(scanner.canHandle('png')).toBe(false);
    expect(scanner.canHandle('mp4')).toBe(false);
    expect(scanner.canHandle('tiff')).toBe(false);
  });
});

describe('PdfScanner.scan — clean file', () => {
  it('returns no dangerous content for a minimal PDF without metadata', () => {
    const data = buildPdf('1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(false);
    expect(result.foundTypes).toEqual([]);
    expect(result.details).toEqual([]);
  });

  it('does not flag benign PDF content', () => {
    const data = buildPdf('1 0 obj\n<< /Author (Jane Doe) /Title (Annual Report) >>\nendobj\n%%EOF\n');
    const result = scanner.scan(data, 'pdf');
    // Author/Title alone are not in the dangerous patterns list
    expect(result.hasDangerousContent).toBe(false);
  });
});

describe('PdfScanner.scan — XMP GPS metadata', () => {
  it('detects GPSLatitude in an XMP packet', () => {
    const xmp = [
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:exif="http://ns.adobe.com/exif/1.0/">',
      '<exif:GPSLatitude>37.3320</exif:GPSLatitude>',
      '</x:xmpmeta>',
      '<?xpacket end="w"?>',
    ].join('');
    const data = new Uint8Array(str('%PDF-1.4\n' + xmp));
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.foundTypes).toContain('location_metadata');
    expect(result.details.some(d => d.includes('GPSLatitude'))).toBe(true);
  });

  it('detects GPSLongitude in XMP', () => {
    const xmp = [
      '<?xpacket begin="" id="abc"?>',
      '<x:xmpmeta><exif:GPSLongitude>-122.0312</exif:GPSLongitude></x:xmpmeta>',
      '<?xpacket end="w"?>',
    ].join('');
    const data = new Uint8Array(str(xmp));
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
  });

  it('detects photoshop:City in XMP', () => {
    const xmp = [
      '<?xpacket begin="" id="abc"?>',
      '<x:xmpmeta><photoshop:City>Amsterdam</photoshop:City></x:xmpmeta>',
      '<?xpacket end="w"?>',
    ].join('');
    const data = new Uint8Array(str(xmp));
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('location_metadata');
  });

  it('detects face recognition metadata (mwg-rs:Regions) in XMP', () => {
    const xmp = [
      '<?xpacket begin="" id="abc"?>',
      '<x:xmpmeta><mwg-rs:Regions><mwg-rs:RegionList/></mwg-rs:Regions></x:xmpmeta>',
      '<?xpacket end="w"?>',
    ].join('');
    const data = new Uint8Array(str(xmp));
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('facial_recognition');
  });

  it('detects x:xmpmeta without <?xpacket?> wrapper', () => {
    const xmp =
      '<x:xmpmeta xmlns:exif="http://ns.adobe.com/exif/1.0/"><exif:GPSLatitude>52.37</exif:GPSLatitude></x:xmpmeta>';
    const data = new Uint8Array(str('%PDF-1.4\n' + xmp));
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
  });
});

describe('PdfScanner.scan — PDF location metadata keys', () => {
  it('detects /Location key in PDF object', () => {
    const data = buildPdf('1 0 obj\n<< /Location (Amsterdam, NL) >>\nendobj\n%%EOF\n');
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('location_metadata');
    expect(result.details.some(d => d.includes('/Location'))).toBe(true);
  });

  it('detects /GPS key in PDF object', () => {
    const data = buildPdf('1 0 obj\n<< /GPS (52.0000, 4.0000) >>\nendobj\n%%EOF\n');
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('location_metadata');
  });

  it('detects /GeoLocation key in PDF object', () => {
    const data = buildPdf('1 0 obj\n<< /GeoLocation (37.3320, -122.0312) >>\nendobj\n%%EOF\n');
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('location_metadata');
  });
});

describe('PdfScanner.scan — edge cases', () => {
  it('does not throw on empty data', () => {
    expect(() => scanner.scan(new Uint8Array(0), 'pdf')).not.toThrow();
    const result = scanner.scan(new Uint8Array(0), 'pdf');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('does not throw on very short data', () => {
    expect(() => scanner.scan(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'pdf')).not.toThrow();
  });

  it('does not flag XMP with no GPS or face data', () => {
    const xmp = [
      '<?xpacket begin="" id="abc"?>',
      '<x:xmpmeta><dc:title>My Document</dc:title></x:xmpmeta>',
      '<?xpacket end="w"?>',
    ].join('');
    const data = new Uint8Array(str(xmp));
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('handles XMP without closing packet marker (uses 100KB limit)', () => {
    // An XMP block without <?xpacket end?> should still scan via the 100KB fallback
    const xmp = '<?xpacket begin="" id="abc"?><x:xmpmeta><exif:GPSLatitude>52.37</exif:GPSLatitude></x:xmpmeta>';
    const data = new Uint8Array(str(xmp));
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
  });
});
