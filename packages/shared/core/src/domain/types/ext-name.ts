import * as S from 'effect/Schema';

const extNames = [
  // HTML extension names
  '.html',
  '.htm',
  '.xhtml',

  // Markdown extension names
  '.md',
  '.markdown',

  // Text extension names
  '.txt',
  '.log',

  // Plain text storage extension names
  '.csv',
  '.tsv',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.toml',

  // Code extension names
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.styl',
  '.php',
  '.py',
  '.rb',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.fs',
  '.fsx',
  '.fsi',
  '.go',
  '.rs',
  '.swift',
  '.kt',
  '.clj',
  '.cljs',
  '.cljc',
  '.edn',
  '.lua',
  '.pl',
  '.r',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.awk',
  '.ps1',
  '.bat',
  '.cmd',
  '.vbs',

  // Audio MIME types
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',

  // Image MIME types
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.tiff',

  // Video MIME types
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.flv',
  '.wmv',

  // Compressed types (optional for binary-focused purposes)
  '.zip',
  '.rar',
  '.7z',

  // Other binary types
  '.pdf',
  '.exe',
  '.bin',
  '.iso',
] as const;

export type ExtName = typeof extNames[number];

const extNameSet = new Set<string>(extNames);

const isExtName = S.makeFilter<string>(s => extNameSet.has(s) ? undefined : `Expected one of: ${extNames.join(', ')}`);

export const ExtNameSchema = S.String.pipe(S.check(isExtName));
