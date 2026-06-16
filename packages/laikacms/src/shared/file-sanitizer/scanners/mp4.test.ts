import { describe, expect, it } from 'vitest';
import { Mp4Scanner } from './mp4.js';

const scanner = new Mp4Scanner();

/**
 * Build a 4-byte big-endian number.
 */
function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/**
 * Build a minimal MP4 box: [size(4)] [type(4)] [payload]
 * size includes the 8-byte header.
 */
function mp4Box(type: string, payload: number[] = []): number[] {
  const size = 8 + payload.length;
  const typeBytes = [...type].map(c => c.charCodeAt(0));
  return [...be32(size), ...typeBytes, ...payload];
}

/**
 * Build a container box that wraps inner boxes.
 */
function containerBox(type: string, children: number[][]): number[] {
  const inner = children.flat();
  return mp4Box(type, inner);
}

/**
 * Encode a string to char codes.
 */
function str(s: string): number[] {
  return [...s].map(c => c.charCodeAt(0));
}

// ©xyz in bytes: 0xA9 0x78 0x79 0x7A
const GPS_XYZ_TYPE = [0xa9, 0x78, 0x79, 0x7a];

function gpsXyzBox(payload: number[] = []): number[] {
  const size = 8 + payload.length;
  return [...be32(size), ...GPS_XYZ_TYPE, ...payload];
}

describe('Mp4Scanner.canHandle', () => {
  it('handles mp4 and mov', () => {
    expect(scanner.canHandle('mp4')).toBe(true);
    expect(scanner.canHandle('mov')).toBe(true);
  });

  it('rejects other types', () => {
    expect(scanner.canHandle('png')).toBe(false);
    expect(scanner.canHandle('pdf')).toBe(false);
  });
});

describe('Mp4Scanner.scan — clean file', () => {
  it('returns no dangerous content for a file with only ftyp + mdat boxes', () => {
    const ftyp = mp4Box('ftyp', [...str('mp42'), 0, 0, 0, 0]);
    const mdat = mp4Box('mdat', [0x00, 0x01, 0x02]);
    const data = new Uint8Array([...ftyp, ...mdat]);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(false);
    expect(result.foundTypes).toEqual([]);
    expect(result.details).toEqual([]);
  });

  it('returns no dangerous content for a moov box with only mvhd inside', () => {
    const mvhd = mp4Box('mvhd', new Array(100).fill(0));
    const moov = containerBox('moov', [mvhd]);
    const data = new Uint8Array(moov);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(false);
  });
});

describe('Mp4Scanner.scan — GPS boxes', () => {
  it('detects a top-level ©xyz box as gps_coordinates', () => {
    const gps = gpsXyzBox(str('+37.3320-122.0312/'));
    const data = new Uint8Array(gps);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.details.some(d => d.includes('©xyz'))).toBe(true);
  });

  it('detects a GPS  box (with trailing space)', () => {
    const gpsBox = mp4Box('GPS ', new Array(20).fill(0));
    const data = new Uint8Array(gpsBox);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
  });

  it('detects a loci box', () => {
    const loci = mp4Box('loci', new Array(10).fill(0));
    const data = new Uint8Array(loci);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
  });

  it('detects GPS box nested inside moov > udta', () => {
    const gps = gpsXyzBox(str('+51.5074-000.1278/'));
    const udta = containerBox('udta', [gps]);
    const moov = containerBox('moov', [udta]);
    const ftyp = mp4Box('ftyp', str('isom').concat([0, 0, 0, 0]));
    const data = new Uint8Array([...ftyp, ...moov]);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
  });
});

describe('Mp4Scanner.scan — truncated / corrupt file', () => {
  it('does not throw on empty data', () => {
    const result = scanner.scan(new Uint8Array(0), 'mp4');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('does not throw on data shorter than one box header', () => {
    const result = scanner.scan(new Uint8Array([0x00, 0x00, 0x00, 0x10]), 'mp4');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('does not throw when a box claims a size larger than the file', () => {
    // Box header: size=0x000000FF (255), type='ftyp', only 8 bytes present
    const data = new Uint8Array([0x00, 0x00, 0x00, 0xff, 0x66, 0x74, 0x79, 0x70]);
    expect(() => scanner.scan(data, 'mp4')).not.toThrow();
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('does not throw on a box with size=0 (would cause infinite loop without guard)', () => {
    // size=0 triggers the skip-by-4 fallback
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x00, 0x00, 0x00, 0x00]);
    expect(() => scanner.scan(data, 'mp4')).not.toThrow();
  });
});

describe('Mp4Scanner.scan — XMP metadata', () => {
  it('detects GPSLatitude in an XMP packet', () => {
    // Embed a minimal XMP packet with GPS latitude
    const xmpOpen = str('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>');
    const xmpContent = str('<x:xmpmeta><exif:GPSLatitude>37.3320</exif:GPSLatitude></x:xmpmeta>');
    const xmpClose = str('<?xpacket end="w"?>');
    const xmpBytes = [...xmpOpen, ...xmpContent, ...xmpClose];
    const data = new Uint8Array(xmpBytes);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.foundTypes).toContain('location_metadata');
  });

  it('detects face recognition data (mwg-rs:Regions) in XMP', () => {
    const xmpOpen = str('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>');
    const xmpContent = str('<x:xmpmeta><mwg-rs:Regions><mwg-rs:RegionList/></mwg-rs:Regions></x:xmpmeta>');
    const xmpClose = str('<?xpacket end="w"?>');
    const xmpBytes = [...xmpOpen, ...xmpContent, ...xmpClose];
    const data = new Uint8Array(xmpBytes);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('facial_recognition');
  });

  it('returns empty result for XMP packet without GPS or face data', () => {
    const xmpOpen = str('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>');
    const xmpContent = str('<x:xmpmeta><dc:title>Vacation</dc:title></x:xmpmeta>');
    const xmpClose = str('<?xpacket end="w"?>');
    const xmpBytes = [...xmpOpen, ...xmpContent, ...xmpClose];
    const data = new Uint8Array(xmpBytes);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(false);
  });
});
