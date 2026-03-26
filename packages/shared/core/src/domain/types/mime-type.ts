import { z } from "zod";
import { ExtName } from "./ext-name.js";

export const mimeTypeZ = z.union([
  z.literal("text/html"),
  z.literal("application/xhtml+xml"),

  // Markdown MIME types
  z.literal("text/markdown"),

  // Text MIME types
  z.literal("text/plain"),
  z.literal("text/csv"),
  z.literal("text/tab-separated-values"),

  // Plain text storage MIME types
  z.literal("application/json"),
  z.literal("application/x-yaml"),
  z.literal("application/xml"),
  z.literal("application/toml"),

  // Code MIME types
  z.literal("application/javascript"),
  z.literal("application/typescript"),
  z.literal("text/jsx"),
  z.literal("text/tsx"),
  z.literal("text/css"),
  z.literal("text/x-scss"),
  z.literal("text/x-sass"),
  z.literal("text/x-clojure"),
  z.literal("application/edn"),
  z.literal("text/x-lua"),
  z.literal("text/x-perl"),
  z.literal("text/x-r"),
  z.literal("application/x-sh"),
  z.literal("application/x-fish"),
  z.literal("application/x-awk"),
  z.literal("application/x-powershell"),
  z.literal("application/x-msdos-program"),
  z.literal("text/vbscript"),
  z.literal("text/x-python"),
  z.literal("text/x-ruby"),
  z.literal("text/x-java-source"),
  z.literal("text/x-c"),
  z.literal("text/x-c++src"),
  z.literal("text/x-c++hdr"),
  z.literal("text/x-csharp"),
  z.literal("text/x-go"),
  z.literal("text/rust"),
  z.literal("text/x-swift"),
  z.literal("text/x-kotlin"),
  z.literal("application/x-httpd-php"),

  // Audio MIME types
  z.literal("audio/mpeg"),
  z.literal("audio/wav"),
  z.literal("audio/ogg"),
  z.literal("audio/flac"),
  z.literal("audio/aac"),

  // Image MIME types
  z.literal("image/jpeg"),
  z.literal("image/png"),
  z.literal("image/gif"),
  z.literal("image/bmp"),
  z.literal("image/webp"),
  z.literal("image/svg+xml"),
  z.literal("image/tiff"),

  // Video MIME types
  z.literal("video/mp4"),
  z.literal("video/quicktime"),
  z.literal("video/x-msvideo"),
  z.literal("video/x-matroska"),
  z.literal("video/webm"),
  z.literal("video/x-flv"),
  z.literal("video/x-ms-wmv"),

  // Compressed types
  z.literal("application/zip"),
  z.literal("application/vnd.rar"),
  z.literal("application/x-7z-compressed"),

  // Other binary types
  z.literal("application/pdf"),
  z.literal("application/vnd.microsoft.portable-executable"),
  z.literal("application/octet-stream"),
  z.literal("application/x-iso9660-image"),
]);

export type MimeType = z.infer<typeof mimeTypeZ>;

export const extNameToMimeType = (extName: ExtName | string): MimeType => {
  if (extName in mimeTypeMapper) {
    const ext = extName as ExtName;
    return mimeTypeMapper[ext];
  } else {
    return "application/octet-stream";
  }
}

export const mimeTypeMapper: Record<ExtName, MimeType> = {
  // HTML MIME types
  ".html": "text/html",
  ".htm": "text/html",
  ".xhtml": "application/xhtml+xml",

  // Markdown MIME types
  ".md": "text/markdown",
  ".markdown": "text/markdown",

  // Text MIME types
  ".txt": "text/plain",
  ".log": "text/plain",

  // Plain text storage MIME types
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".xml": "application/xml",
  ".toml": "application/toml",

  // Code MIME types
  ".js": "application/javascript",
  ".ts": "application/typescript",
  ".jsx": "text/jsx",
  ".tsx": "text/tsx",
  ".css": "text/css",
  ".scss": "text/x-scss",
  ".sass": "text/x-sass",
  ".less": "text/css",
  ".styl": "text/plain",
  ".php": "application/x-httpd-php",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".java": "text/x-java-source",
  ".c": "text/x-c",
  ".cpp": "text/x-c++src",
  ".h": "text/x-c",
  ".hpp": "text/x-c++hdr",
  ".cs": "text/x-csharp",
  ".fs": "text/plain",
  ".fsx": "text/plain",
  ".fsi": "text/plain",
  ".go": "text/x-go",
  ".rs": "text/rust",
  ".swift": "text/x-swift",
  ".kt": "text/x-kotlin",
  ".clj": "text/x-clojure",
  ".cljs": "text/x-clojure",
  ".cljc": "text/x-clojure",
  ".edn": "application/edn",
  ".lua": "text/x-lua",
  ".pl": "text/x-perl",
  ".r": "text/x-r",
  ".sh": "application/x-sh",
  ".bash": "application/x-sh",
  ".zsh": "application/x-sh",
  ".fish": "application/x-fish",
  ".awk": "application/x-awk",
  ".ps1": "application/x-powershell",
  ".bat": "application/x-msdos-program",
  ".cmd": "application/x-msdos-program",
  ".vbs": "text/vbscript",

  // Audio MIME types
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",

  // Image MIME types
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".tiff": "image/tiff",

  // Video MIME types
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".flv": "video/x-flv",
  ".wmv": "video/x-ms-wmv",

  // Compressed types
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",

  // Other binary types
  ".pdf": "application/pdf",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".bin": "application/octet-stream",
  ".iso": "application/x-iso9660-image",
};
