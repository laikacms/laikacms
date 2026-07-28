# laikacms/file-sanitizer

[![npm](https://img.shields.io/npm/v/laikacms)](https://www.npmjs.com/package/laikacms)
[![npm](https://img.shields.io/npm/dm/laikacms)](https://www.npmjs.com/package/laikacms)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/laikacms)](https://bundlephobia.com/result?p=laikacms)

Best-effort file sanitization for uploaded content.

## Features

- Image sanitization (JPEG, PNG, GIF, WebP) — metadata stripped, sanitized data returned
- Dangerous-content scanning for TIFF, PDF, MP4, MOV, AVI, HEIC, HEIF — rejected if dangerous
  content found
- MIME type verification

## Installation

```bash
pnpm add laikacms
```

## Usage

```typescript
import { DangerousFileTypeError, FileTooLargeError, UnsupportedFileTypeError } from 'laikacms/core';
import { sanitizeFile } from 'laikacms/file-sanitizer';

const blob = await request.blob();
const data = new Uint8Array(await blob.arrayBuffer());

try {
  // sanitizeFile returns on success and throws on oversized/unsupported/dangerous/corrupted input
  const result = await sanitizeFile(data);
  const sanitized = result.data; // Uint8Array with metadata stripped
} catch (err) {
  if (err instanceof FileTooLargeError) {
    // File exceeds maxFileSize (default 100 MB)
  } else if (err instanceof DangerousFileTypeError) {
    // File contains dangerous metadata (GPS, embedded scripts, …)
  } else if (err instanceof UnsupportedFileTypeError) {
    // File type is not supported or MIME type mismatch
  } else {
    throw err; // CorruptedFileError or unexpected
  }
}
```

## Supported Formats

### Sanitized formats — metadata stripped, sanitized data returned

These file types are fully processed: dangerous metadata is stripped and the sanitized `Uint8Array`
is returned to the caller.

| Format | Sanitization                                            |
| ------ | ------------------------------------------------------- |
| JPEG   | EXIF/IPTC/XMP stripping, marker-based validation        |
| PNG    | Privacy-sensitive chunk stripping (tEXt, eXIf, tIME, …) |
| GIF    | Block-based structure validation                        |
| WebP   | RIFF container validation                               |

### Scanned formats — rejected if dangerous content found

These file types are **not sanitized**. `sanitizeFile` scans them for dangerous content (e.g.
embedded GPS coordinates, scripts, or privacy-sensitive metadata) and then always throws an error:

- `DangerousFileTypeError` — dangerous content was detected
- `UnsupportedFileTypeError` — no dangerous content, but the type cannot be sanitized

| Format | Scan performed                                   |
| ------ | ------------------------------------------------ |
| TIFF   | Tag-level scan for dangerous metadata            |
| PDF    | Embedded JavaScript detection                    |
| MP4    | Container structure scan (GPS/location metadata) |
| MOV    | Container structure scan + XMP metadata scan     |
| AVI    | XMP metadata scan (GPS/face-recognition data)    |
| HEIC   | XMP metadata scan (GPS/face-recognition data)    |
| HEIF   | XMP metadata scan (GPS/face-recognition data)    |

To pass these types through without any checks, add them to `ignoreExtensions` in `SanitizeOptions`
— but only when you have other security measures in place.

## Disclaimer

> [!CAUTION] **This package provides BEST-EFFORT sanitization only.**
>
> This is **not** a comprehensive security solution. It is designed to catch common accidents (e.g.,
> files with wrong extensions), detect basic malicious patterns, and strip potentially dangerous
> metadata.
>
> It will **NOT** stop determined attackers, detect sophisticated malware, guarantee file safety, or
> replace proper antivirus scanning.
>
> **Do not rely on this package as your sole defense against malicious uploads.**

### Recommended Additional Measures

1. **Isolated Storage** - Store uploads in sandboxed environments
2. **Antivirus Scanning** - Use dedicated malware detection services
3. **Access Restrictions** - Limit file access permissions
4. **CDN Delivery** - Serve files through secure CDNs with proper headers
5. **Content-Type Headers** - Always set correct `Content-Type` and
   `X-Content-Type-Options: nosniff`

### Liability

The maintainers are **not responsible** for any security incidents resulting from malicious file
uploads. This package is provided "as is" without warranty. See the [LICENSE](../../../LICENSE) for
full terms.

## License

MIT
