/**
 * Represents a directory entry in R2 (simulated via key prefixes)
 */
export interface R2DirEntry {
  type: 'dir';
  key: string;
}

/**
 * Represents a file entry in R2
 */
export interface R2FileEntry {
  type: 'file';
  key: string;
}

/**
 * Union type for R2 entries (either file or directory)
 */
export type R2Entry = R2DirEntry | R2FileEntry;

/**
 * Represents a file with its content
 */
export interface R2File {
  type: 'file';
  key: string;
  content: string;
}

/**
 * Represents a directory with its entries
 */
export interface R2Dir {
  type: 'dir';
  key: string;
  entries: R2Entry[];
}

/**
 * Union type for R2 file or directory with content
 */
export type R2FileOrDir = R2File | R2Dir;
