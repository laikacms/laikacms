import { describe, expect, it } from 'vitest';
import { GenericScanner } from './generic.js';

const scanner = new GenericScanner();

function str(s: string): number[] {
  return [...s].map(c => c.charCodeAt(0));
}

function buildPayload(...parts: string[]): Uint8Array {
  return new Uint8Array(parts.flatMap(p => str(p)));
}

// GPS pattern guaranteed to trigger gps_coordinates detection
const GPS_XMP_BODY = '<exif:GPSLatitude>37.3320</exif:GPSLatitude>';

describe('GenericScanner.canHandle', () => {
  it('handles unknown and video types', () => {
    expect(scanner.canHandle('unknown')).toBe(true);
    expect(scanner.canHandle('heic')).toBe(true);
    expect(scanner.canHandle('heif')).toBe(true);
    expect(scanner.canHandle('avi')).toBe(true);
    expect(scanner.canHandle('mov')).toBe(true);
  });

  it('handles types outside its supportedTypes list via canHandle override', () => {
    // GenericScanner.canHandle always returns true (fallback scanner)
    expect(scanner.canHandle('png')).toBe(true);
    expect(scanner.canHandle('jpeg')).toBe(true);
  });
});

describe('GenericScanner.scan — no XMP markers present', () => {
  it('returns no dangerous content for a payload with no XMP markers', () => {
    const data = buildPayload('This is arbitrary binary data with no metadata markers.');
    const result = scanner.scan(data, 'unknown');
    expect(result.hasDangerousContent).toBe(false);
    expect(result.foundTypes).toEqual([]);
    expect(result.details).toEqual([]);
  });

  it('returns no dangerous content for an empty payload', () => {
    const result = scanner.scan(new Uint8Array(0), 'unknown');
    expect(result.hasDangerousContent).toBe(false);
  });
});

describe('GenericScanner.scan — x:xmpmeta fallback path', () => {
  it('detects GPS coordinates in an x:xmpmeta block (no <?xpacket wrapper)', () => {
    const data = buildPayload(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:exif="http://ns.adobe.com/exif/1.0/">',
      GPS_XMP_BODY,
      '</x:xmpmeta>',
    );
    const result = scanner.scan(data, 'heic');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.foundTypes).toContain('location_metadata');
  });

  it('returns no dangerous content for an x:xmpmeta block with no dangerous patterns', () => {
    const data = buildPayload(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '<dc:title>My Photo</dc:title>',
      '</x:xmpmeta>',
    );
    const result = scanner.scan(data, 'heic');
    expect(result.hasDangerousContent).toBe(false);
    expect(result.foundTypes).toEqual([]);
  });

  it('detects face recognition data in an x:xmpmeta block', () => {
    const data = buildPayload(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '<mwg-rs:Regions><mwg-rs:RegionList><mwg-rs:Name>Alice</mwg-rs:Name></mwg-rs:RegionList></mwg-rs:Regions>',
      '</x:xmpmeta>',
    );
    const result = scanner.scan(data, 'heif');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('facial_recognition');
  });
});

describe('GenericScanner.scan — rdf:RDF fallback path', () => {
  it('detects GPS coordinates in a bare rdf:RDF block (no xpacket or xmpmeta wrapper)', () => {
    const data = buildPayload(
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:exif="http://ns.adobe.com/exif/1.0/">',
      GPS_XMP_BODY,
      '</rdf:RDF>',
    );
    const result = scanner.scan(data, 'avi');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
  });

  it('returns no dangerous content for a bare rdf:RDF block with no dangerous patterns', () => {
    const data = buildPayload(
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '<rdf:Description rdf:about="">',
      '<dc:format>image/heic</dc:format>',
      '</rdf:Description>',
      '</rdf:RDF>',
    );
    const result = scanner.scan(data, 'avi');
    expect(result.hasDangerousContent).toBe(false);
    expect(result.foundTypes).toEqual([]);
  });
});

describe('GenericScanner.scan — <?xpacket path (regression guard)', () => {
  it('detects GPS in a full <?xpacket … ?> wrapped XMP block', () => {
    const data = buildPayload(
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:exif="http://ns.adobe.com/exif/1.0/">',
      GPS_XMP_BODY,
      '</x:xmpmeta>',
      '<?xpacket end="w"?>',
    );
    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
  });
});
