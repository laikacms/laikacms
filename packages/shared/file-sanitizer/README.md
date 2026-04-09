# @laikacms/file-sanitizer

[![npm](https://img.shields.io/npm/v/@laikacms/file-sanitizer)](https://www.npmjs.com/package/@laikacms/file-sanitizer)
[![npm](https://img.shields.io/npm/dm/@laikacms/file-sanitizer)](https://www.npmjs.com/package/@laikacms/file-sanitizer)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/file-sanitizer)](https://bundlephobia.com/result?p=@laikacms/file-sanitizer)

Best-effort file sanitization for uploaded content.

## Features

- Image sanitization (JPEG, PNG, GIF, WebP, TIFF)
- PDF scanning for embedded JavaScript
- MP4 container validation
- MIME type verification

## Installation

```bash
pnpm add @laikacms/file-sanitizer
```

## Usage

```typescript
import { detectFileType, sanitizeFile } from '@laikacms/file-sanitizer';

const file = await request.blob();
const result = await sanitizeFile(file);

if (result.safe) {
  // File passed basic sanitization
  const sanitized = result.data;
}
```

## Supported Formats

| Format | Sanitization                         |
| ------ | ------------------------------------ |
| JPEG   | EXIF stripping, structure validation |
| PNG    | Chunk validation                     |
| GIF    | Structure validation                 |
| WebP   | Container validation                 |
| TIFF   | Tag validation                       |
| PDF    | JavaScript detection                 |
| MP4    | Container structure validation       |

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
