/**
 * Detect privacy-sensitive metadata patterns inside a payload.
 *
 * Used as a gate in the sanitizers before stripping comment-like
 * containers (JPEG COM, GIF Comment / Plain Text extensions, PNG tEXt /
 * iTXt). Comments often carry benign content — tool signatures, captions,
 * licensing text — so we only remove them when their payload actually
 * contains GPS coordinates, place metadata, face-recognition data, or an
 * embedded EXIF / IPTC payload.
 *
 * Pattern list intentionally focuses on what the user cares about:
 * GPS / location / facial recognition / "that kind of metadata".
 */

const DANGEROUS_PATTERNS: ReadonlyArray<string> = [
  // GPS / coordinates
  'GPSLatitude',
  'GPSLongitude',
  'GPSAltitude',
  'GPSPosition',
  'GPSCoordinates',
  'exif:GPS',
  // Place / address metadata
  'photoshop:City',
  'photoshop:State',
  'photoshop:Country',
  'Iptc4xmpCore:Location',
  'Iptc4xmpCore:CountryCode',
  'IptcCore:Location',
  // Face / person recognition
  'mwg-rs:Regions',
  'mwg-rs:RegionList',
  'mwg-rs:Name',
  'MP:RegionInfo',
  'MPReg:PersonDisplayName',
  'xmpDM:faceRegion',
  'apple:FaceInfo',
  'FaceRegion',
  'PersonInImage',
  // Embedded EXIF / IPTC payloads (someone tucking metadata inside a comment)
  'Exif\0\0',
  'Photoshop 3.0\0',
];

export interface DangerousMetadataMatch {
  dangerous: boolean;
  matched: string[];
}

function bytesContainAscii(data: Uint8Array, pattern: string): boolean {
  if (pattern.length === 0) return true;
  if (pattern.length > data.length) return false;
  outer: for (let i = 0; i <= data.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern.charCodeAt(j)) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

/**
 * Scan a payload for dangerous metadata patterns. Returns `{ dangerous:
 * false, matched: [] }` for benign content (e.g. tool signatures, plain
 * captions) and a populated match list when GPS / location / face /
 * embedded-EXIF patterns are found.
 */
export function findDangerousMetadata(payload: Uint8Array): DangerousMetadataMatch {
  const matched: string[] = [];
  for (const pattern of DANGEROUS_PATTERNS) {
    if (bytesContainAscii(payload, pattern)) {
      matched.push(pattern);
    }
  }
  return { dangerous: matched.length > 0, matched };
}
