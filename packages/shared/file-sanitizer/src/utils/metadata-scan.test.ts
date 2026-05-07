import { describe, expect, it } from 'vitest';
import { findDangerousMetadata } from './metadata-scan.js';

function bytes(text: string): Uint8Array {
  return new Uint8Array([...text].map(c => c.charCodeAt(0)));
}

describe('findDangerousMetadata', () => {
  it('reports benign content as safe', () => {
    const result = findDangerousMetadata(bytes('Made with GIMP'));
    expect(result.dangerous).toBe(false);
    expect(result.matched).toEqual([]);
  });

  it('returns safe for an empty payload', () => {
    expect(findDangerousMetadata(new Uint8Array(0)).dangerous).toBe(false);
  });

  it('detects GPS coordinate keywords', () => {
    expect(findDangerousMetadata(bytes('foo GPSLatitude=1.0 bar')).dangerous).toBe(true);
    expect(findDangerousMetadata(bytes('GPSLongitude')).dangerous).toBe(true);
    expect(findDangerousMetadata(bytes('exif:GPSLatitude')).dangerous).toBe(true);
  });

  it('detects place / address metadata', () => {
    expect(findDangerousMetadata(bytes('photoshop:City=Amsterdam')).dangerous).toBe(true);
    expect(findDangerousMetadata(bytes('Iptc4xmpCore:Location=...')).dangerous).toBe(true);
  });

  it('detects face / person recognition patterns', () => {
    expect(findDangerousMetadata(bytes('<mwg-rs:Regions>Alice</mwg-rs:Regions>')).dangerous).toBe(true);
    expect(findDangerousMetadata(bytes('PersonInImage')).dangerous).toBe(true);
    expect(findDangerousMetadata(bytes('FaceRegion=...')).dangerous).toBe(true);
  });

  it('detects an embedded EXIF payload sneaked into a comment', () => {
    const exif = new Uint8Array([
      ...[...'preface text '].map(c => c.charCodeAt(0)),
      0x45,
      0x78,
      0x69,
      0x66,
      0x00,
      0x00, // "Exif\0\0"
      0xaa,
      0xbb,
    ]);
    expect(findDangerousMetadata(exif).dangerous).toBe(true);
  });

  it('returns the list of matched patterns for debugging', () => {
    const result = findDangerousMetadata(bytes('GPSLatitude and FaceRegion together'));
    expect(result.matched).toContain('GPSLatitude');
    expect(result.matched).toContain('FaceRegion');
  });
});
