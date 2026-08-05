/**
 * A directory entry derived from scanning Web Storage keys under a prefix.
 * Web Storage is a flat key-value store; folders have no physical record and
 * are synthesized from the common prefixes of sibling keys (the same
 * technique `storage-r2` uses for R2's flat object namespace).
 */
export interface WebStorageDirEntry {
  type: 'dir';
  key: string;
}

/** A file entry derived from a physical Web Storage key under a prefix. */
export interface WebStorageFileEntry {
  type: 'file';
  key: string;
}

export type WebStorageEntry = WebStorageDirEntry | WebStorageFileEntry;
