/**
 * A directory entry produced by listing one level of a real directory.
 * Unlike the flat-store implementations (`storage-r2`, `storage-web`), these
 * are not synthesized from key prefixes — the directories physically exist,
 * so empty folders list as an empty array rather than requiring `.keep`
 * markers.
 */
export interface WebFsDirEntry {
  type: 'dir';
  key: string;
}

/** A file entry produced by listing a directory; `key` still carries the physical extension. */
export interface WebFsFileEntry {
  type: 'file';
  key: string;
}

export type WebFsEntry = WebFsDirEntry | WebFsFileEntry;
