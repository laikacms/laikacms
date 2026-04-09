import * as S from 'effect/Schema';
import { ExtName } from './ext-name.js';

/**
 * All supported MIME types as a const array for Effect Schema.
 */
const mimeTypes = [
  'text/html',
  'application/xhtml+xml',
  'text/markdown',
  'text/plain',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/x-yaml',
  'application/xml',
  'application/toml',
  'application/javascript',
  'application/typescript',
  'text/jsx',
  'text/tsx',
  'text/css',
  'text/x-scss',
  'text/x-sass',
  'text/x-clojure',
  'application/edn',
  'text/x-lua',
  'text/x-perl',
  'text/x-r',
  'application/x-sh',
  'application/x-fish',
  'application/x-awk',
  'application/x-powershell',
  'application/x-msdos-program',
  'text/vbscript',
  'text/x-python',
  'text/x-ruby',
  'text/x-java-source',
  'text/x-c',
  'text/x-c++src',
  'text/x-c++hdr',
  'text/x-csharp',
  'text/x-go',
  'text/rust',
  'text/x-swift',
  'text/x-kotlin',
  'application/x-httpd-php',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/svg+xml',
  'image/tiff',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/x-flv',
  'video/x-ms-wmv',
  'application/zip',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/pdf',
  'application/vnd.microsoft.portable-executable',
  'application/octet-stream',
  'application/x-iso9660-image',
] as const;

export type MimeType = typeof mimeTypes[number];

const mimeTypeSet = new Set<string>(mimeTypes);

const isMimeType = S.makeFilter<string>(s =>
  mimeTypeSet.has(s) ? undefined : `Expected one of: ${mimeTypes.join(', ')}`
);

/**
 * Effect Schema for MIME types.
 */
export const MimeTypeSchema = S.String.pipe(S.check(isMimeType));

export const extNameToMimeType = (extName: ExtName | string): MimeType => {
  if (extName in mimeTypeMapper) {
    const ext = extName as ExtName;
    return mimeTypeMapper[ext];
  } else {
    return 'application/octet-stream';
  }
};

export const mimeTypeMapper: Record<ExtName, MimeType> = {
  // HTML MIME types
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'application/xhtml+xml',

  // Markdown MIME types
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',

  // Text MIME types
  '.txt': 'text/plain',
  '.log': 'text/plain',

  // Plain text storage MIME types
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.xml': 'application/xml',
  '.toml': 'application/toml',

  // Code MIME types
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.jsx': 'text/jsx',
  '.tsx': 'text/tsx',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.sass': 'text/x-sass',
  '.less': 'text/css',
  '.styl': 'text/plain',
  '.php': 'application/x-httpd-php',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++src',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++hdr',
  '.cs': 'text/x-csharp',
  '.fs': 'text/plain',
  '.fsx': 'text/plain',
  '.fsi': 'text/plain',
  '.go': 'text/x-go',
  '.rs': 'text/rust',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.clj': 'text/x-clojure',
  '.cljs': 'text/x-clojure',
  '.cljc': 'text/x-clojure',
  '.edn': 'application/edn',
  '.lua': 'text/x-lua',
  '.pl': 'text/x-perl',
  '.r': 'text/x-r',
  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.zsh': 'application/x-sh',
  '.fish': 'application/x-fish',
  '.awk': 'application/x-awk',
  '.ps1': 'application/x-powershell',
  '.bat': 'application/x-msdos-program',
  '.cmd': 'application/x-msdos-program',
  '.vbs': 'text/vbscript',

  // Audio MIME types
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',

  // Image MIME types
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.tiff': 'image/tiff',

  // Video MIME types
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',

  // Compressed types
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',

  // Other binary types
  '.pdf': 'application/pdf',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.bin': 'application/octet-stream',
  '.iso': 'application/x-iso9660-image',
};
