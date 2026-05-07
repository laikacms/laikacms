import { describe, expect, it } from 'vitest';
import { GenericScanner } from './generic.js';
import { getScannersForType, scanForDangerousContent } from './index.js';
import { Mp4Scanner } from './mp4.js';
import { PdfScanner } from './pdf.js';
import { TiffScanner } from './tiff.js';
import type { DangerousContentType } from './types.js';
import { dangerousScanResult, emptyScanResult, mergeScanResults } from './types.js';

function asciiBytes(text: string): number[] {
  return [...text].map(c => c.charCodeAt(0));
}

function buf(...parts: (number[] | Uint8Array | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') out.push(...asciiBytes(part));
    else if (part instanceof Uint8Array) out.push(...Array.from(part));
    else out.push(...part);
  }
  return new Uint8Array(out);
}

/** Build an ISO-BMFF box: 4-byte BE size, 4-byte type, body. */
function isoBox(type: string, body: number[] | Uint8Array | string): number[] {
  const bodyArr = typeof body === 'string'
    ? asciiBytes(body)
    : body instanceof Uint8Array
    ? Array.from(body)
    : body;
  const size = 8 + bodyArr.length;
  const sizeBytes = [(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff];
  const typeBytes = asciiBytes(type);
  return [...sizeBytes, ...typeBytes, ...bodyArr];
}

describe('scanner types: result helpers', () => {
  it('emptyScanResult is benign', () => {
    const r = emptyScanResult();
    expect(r.hasDangerousContent).toBe(false);
    expect(r.foundTypes).toEqual([]);
    expect(r.details).toEqual([]);
  });

  it('dangerousScanResult flags content', () => {
    const r = dangerousScanResult(['gps_coordinates'], ['Found GPS']);
    expect(r.hasDangerousContent).toBe(true);
    expect(r.foundTypes).toEqual(['gps_coordinates']);
    expect(r.details).toEqual(['Found GPS']);
  });

  it('mergeScanResults dedupes foundTypes but concatenates details', () => {
    const a = dangerousScanResult(['gps_coordinates'], ['from A']);
    const b = dangerousScanResult(['gps_coordinates', 'facial_recognition'], ['from B']);
    const r = mergeScanResults(a, b, emptyScanResult());
    expect(r.hasDangerousContent).toBe(true);
    expect(r.foundTypes.sort()).toEqual(['facial_recognition', 'gps_coordinates']);
    expect(r.details).toEqual(['from A', 'from B']);
  });

  it('mergeScanResults of zero results is benign', () => {
    expect(mergeScanResults().hasDangerousContent).toBe(false);
  });
});

describe('GenericScanner', () => {
  const scanner = new GenericScanner();

  it('handles every file type as a fallback', () => {
    expect(scanner.canHandle('unknown')).toBe(true);
    expect(scanner.canHandle('mp4')).toBe(true);
    expect(scanner.canHandle('pdf')).toBe(true);
  });

  it('returns benign for plain content with no XMP', () => {
    const result = scanner.scan(buf('hello world, just text'), 'unknown');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('detects GPS via <?xpacket marker', () => {
    const data = buf('<?xpacket begin?><x:xmpmeta>GPSLatitude=1.0</x:xmpmeta><?xpacket end?>');
    const result = scanner.scan(data, 'unknown');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.foundTypes).toContain('location_metadata');
  });

  it('detects GPS via x:xmpmeta when xpacket is absent', () => {
    const data = buf('<x:xmpmeta>exif:GPSLatitude</x:xmpmeta>');
    const result = scanner.scan(data, 'unknown');
    expect(result.hasDangerousContent).toBe(true);
  });

  it('detects via rdf:RDF as a last resort', () => {
    const data = buf('preamble bytes... <rdf:RDF>photoshop:City=Berlin</rdf:RDF>');
    const result = scanner.scan(data, 'unknown');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('location_metadata');
  });

  it('detects face-recognition patterns inside XMP', () => {
    const data = buf('<?xpacket begin?><mwg-rs:Regions>Alice</mwg-rs:Regions><?xpacket end?>');
    const result = scanner.scan(data, 'unknown');
    expect(result.foundTypes).toContain('facial_recognition');
  });
});

describe('Mp4Scanner', () => {
  const scanner = new Mp4Scanner();

  it('handles only mp4/mov', () => {
    expect(scanner.canHandle('mp4')).toBe(true);
    expect(scanner.canHandle('mov')).toBe(true);
    expect(scanner.canHandle('avi')).toBe(false);
    expect(scanner.canHandle('pdf')).toBe(false);
  });

  it('detects an ©xyz GPS box at the top level', () => {
    // Apple-style location box: ©xyz with "+37.4-122.1/" style payload.
    const xyz = isoBox('©xyz', '+37.4-122.1/');
    const data = new Uint8Array(xyz);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
  });

  it('finds GPS boxes nested under moov > udta > meta', () => {
    const xyz = isoBox('©xyz', '+37.4-122.1/');
    const meta = isoBox('meta', xyz);
    const udta = isoBox('udta', meta);
    const moov = isoBox('moov', udta);
    const data = new Uint8Array(moov);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(true);
  });

  it('detects XMP GPS metadata in the body', () => {
    const xmp = '<?xpacket begin?><x:xmpmeta>GPSLatitude=1.0</x:xmpmeta><?xpacket end?>';
    const data = buf('preamble', xmp);
    const result = scanner.scan(data, 'mp4');
    expect(result.hasDangerousContent).toBe(true);
  });

  it('returns benign for an MP4 with no GPS or XMP', () => {
    const moov = isoBox('moov', isoBox('mvhd', new Array(100).fill(0)));
    const data = new Uint8Array(moov);
    expect(scanner.scan(data, 'mp4').hasDangerousContent).toBe(false);
  });

  it('does not crash on a malformed box size', () => {
    // Box claiming a size of 4 (less than the required 8 bytes).
    const data = new Uint8Array([0, 0, 0, 4, 0x6d, 0x6f, 0x6f, 0x76, 0xff, 0xff]);
    expect(() => scanner.scan(data, 'mp4')).not.toThrow();
  });
});

describe('PdfScanner', () => {
  const scanner = new PdfScanner();

  it('handles only pdf', () => {
    expect(scanner.canHandle('pdf')).toBe(true);
    expect(scanner.canHandle('mp4')).toBe(false);
  });

  it('detects XMP GPS metadata', () => {
    const data = buf('%PDF-1.7\n', '<?xpacket begin?><x:xmpmeta>GPSLongitude</x:xmpmeta><?xpacket end?>');
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
  });

  it('detects PDF /Location dictionary key', () => {
    const data = buf('%PDF-1.7\n/Location (Berlin)');
    const result = scanner.scan(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('location_metadata');
  });

  it('detects PDF /GeoLocation key', () => {
    const data = buf('%PDF-1.7\n/GeoLocation 12.0');
    expect(scanner.scan(data, 'pdf').hasDangerousContent).toBe(true);
  });

  it('detects face-recognition patterns inside XMP', () => {
    const data = buf('<?xpacket begin?><mwg-rs:RegionList>Alice</mwg-rs:RegionList><?xpacket end?>');
    const result = scanner.scan(data, 'pdf');
    expect(result.foundTypes).toContain('facial_recognition');
  });

  it('returns benign for a PDF with no metadata patterns', () => {
    const data = buf('%PDF-1.7\n%%EOF');
    expect(scanner.scan(data, 'pdf').hasDangerousContent).toBe(false);
  });
});

describe('TiffScanner', () => {
  const scanner = new TiffScanner();

  it('handles only tiff', () => {
    expect(scanner.canHandle('tiff')).toBe(true);
    expect(scanner.canHandle('heic')).toBe(false);
  });

  it('returns benign for too-small input', () => {
    expect(scanner.scan(new Uint8Array([0, 1, 2]), 'tiff').hasDangerousContent).toBe(false);
  });

  it('returns benign for a TIFF without a GPS IFD pointer', () => {
    // Little-endian TIFF: "II" 42 ifdOffset=8, then 0 entries.
    const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 0, 0]);
    expect(scanner.scan(tiff, 'tiff').hasDangerousContent).toBe(false);
  });

  it('detects a GPS IFD with GPSLatitude tag (little-endian)', () => {
    // Build TIFF: header (8) + IFD0 (1 entry pointing to GPS IFD) + GPS IFD (1 entry, GPSLatitude tag)
    const ifd0Offset = 8;
    const gpsIfdOffset = 8 + 2 + 12 + 4; // header + IFD0 (1 entry, 12 bytes + next-IFD offset)

    const data = new Uint8Array(64);
    // Header: "II" 42 ifdOffset
    data.set([0x49, 0x49, 0x2a, 0x00, ifd0Offset, 0, 0, 0]);
    // IFD0: 1 entry
    data[8] = 0x01;
    data[9] = 0x00;
    // Entry 0: tag=0x8825 (GPS_IFD_POINTER), type=4 (LONG), count=1, value=gpsIfdOffset
    data.set([0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, gpsIfdOffset, 0, 0, 0], 10);
    // Next IFD offset = 0
    data.set([0, 0, 0, 0], 22);
    // GPS IFD: 1 entry
    data[gpsIfdOffset] = 0x01;
    data[gpsIfdOffset + 1] = 0x00;
    // Entry 0: tag=0x0002 (GPSLatitude), type=5 (RATIONAL), count=3, valueOffset=0
    data.set([0x02, 0x00, 0x05, 0x00, 0x03, 0x00, 0x00, 0x00, 0, 0, 0, 0], gpsIfdOffset + 2);

    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('gps_coordinates');
    expect(result.foundTypes).toContain('location_metadata');
  });

  it('detects XMP via tag 0x02BC pointing to a GPS-bearing payload', () => {
    const xmpString = '<x:xmpmeta>GPSLatitude=1.0</x:xmpmeta>';
    const xmpBytes = asciiBytes(xmpString);
    // Layout: [0..7] header, [8..23] IFD (1 entry, 12 bytes + 4 next-IFD), [24+] XMP payload
    const xmpOffset = 24;
    const data = new Uint8Array(xmpOffset + xmpBytes.length);

    // Big-endian TIFF: "MM" 42 ifdOffset=8
    data.set([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);
    // IFD0: 1 entry
    data[8] = 0x00;
    data[9] = 0x01;
    // Entry: tag=0x02BC (XMP), type=1 (BYTE), count=xmpBytes.length, valueOffset=xmpOffset
    data.set(
      [
        0x02,
        0xbc,
        0x00,
        0x01,
        (xmpBytes.length >>> 24) & 0xff,
        (xmpBytes.length >>> 16) & 0xff,
        (xmpBytes.length >>> 8) & 0xff,
        xmpBytes.length & 0xff,
        (xmpOffset >>> 24) & 0xff,
        (xmpOffset >>> 16) & 0xff,
        (xmpOffset >>> 8) & 0xff,
        xmpOffset & 0xff,
      ],
      10,
    );
    // Next IFD offset
    data.set([0, 0, 0, 0], 22);
    data.set(xmpBytes, xmpOffset);

    const result = scanner.scan(data, 'tiff');
    expect(result.hasDangerousContent).toBe(true);
    const types: DangerousContentType[] = ['gps_coordinates', 'location_metadata'];
    for (const t of types) expect(result.foundTypes).toContain(t);
  });
});

describe('scanForDangerousContent (orchestrator)', () => {
  it('returns benign for an empty unknown buffer', () => {
    const result = scanForDangerousContent(new Uint8Array(0), 'unknown');
    expect(result.hasDangerousContent).toBe(false);
  });

  it('routes pdf data through PdfScanner', () => {
    const data = buf('%PDF-1.7\n/Location (Paris)');
    const result = scanForDangerousContent(data, 'pdf');
    expect(result.hasDangerousContent).toBe(true);
    expect(result.foundTypes).toContain('location_metadata');
  });

  it('runs both Mp4 and Generic scanners on mp4 input', () => {
    const xmp = '<?xpacket begin?><x:xmpmeta>FaceRegion</x:xmpmeta><?xpacket end?>';
    const data = buf(xmp);
    const result = scanForDangerousContent(data, 'mp4');
    expect(result.foundTypes).toContain('facial_recognition');
  });

  it('returns benign for benign content even on supported types', () => {
    const data = buf('plain video bytes, no metadata');
    expect(scanForDangerousContent(data, 'mp4').hasDangerousContent).toBe(false);
  });
});

describe('getScannersForType', () => {
  it('returns Mp4Scanner + GenericScanner for mp4', () => {
    const scanners = getScannersForType('mp4');
    const names = scanners.map(s => s.constructor.name).sort();
    expect(names).toEqual(['GenericScanner', 'Mp4Scanner']);
  });

  it('returns TiffScanner + GenericScanner for tiff', () => {
    const names = getScannersForType('tiff').map(s => s.constructor.name).sort();
    expect(names).toEqual(['GenericScanner', 'TiffScanner']);
  });

  it('returns at least the GenericScanner for unknown', () => {
    const names = getScannersForType('unknown').map(s => s.constructor.name);
    expect(names).toContain('GenericScanner');
  });
});
