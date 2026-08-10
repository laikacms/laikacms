/**
 * Minimal structural contracts for the file-system-handle surface this
 * implementation needs from the web File System API — regardless of whether a
 * handle points into the origin-private file system or a user-picked on-disk
 * directory. The real DOM types (`FileSystemDirectoryHandle`,
 * `FileSystemFileHandle`, `File`,
 * `FileSystemWritableFileStream`) satisfy these structurally, and an
 * in-memory shim can implement them in Node without any browser APIs — the
 * same injection-seam pattern `storage-web` uses with the Web `Storage`
 * interface.
 */

/** The read-side view of a file: `FileSystemFileHandle.getFile()`'s `File`, reduced to what is consumed. */
export interface WebFsFileSnapshot {
  /** Milliseconds since epoch of the last modification — the only timestamp the File System API keeps. */
  readonly lastModified: number;
  text(): Promise<string>;
}

/** The write-side view of a file: a `FileSystemWritableFileStream`, reduced to what is consumed. */
export interface WebFsWritableStream {
  write(data: string): Promise<void>;
  /** Commits the written data to the file (File System API writes are atomic-on-close). */
  close(): Promise<void>;
}

/** Structural subset of `FileSystemFileHandle`. */
export interface WebFsFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<WebFsFileSnapshot>;
  createWritable(): Promise<WebFsWritableStream>;
}

/** The permission states of the File System Access API's `PermissionState`. */
export type WebFsPermissionState = 'granted' | 'denied' | 'prompt';

/** The access mode permissions are queried for. */
export type WebFsAccessMode = 'read' | 'readwrite';

/** Structural subset of `FileSystemDirectoryHandle`. */
export interface WebFsDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<WebFsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<WebFsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, WebFsDirectoryHandle | WebFsFileHandle]>;
  /**
   * Present on user-picked handles (`showDirectoryPicker()`) in Chromium;
   * typically absent on origin-private handles and in engines that don't ship
   * the WICG permission surface (it is also absent from `lib.dom`, hence
   * optional-structural). Absence is treated as `'granted'` — a handle that
   * cannot be asked about permission cannot have lost it.
   */
  queryPermission?(descriptor: { mode: WebFsAccessMode }): Promise<WebFsPermissionState>;
}

/**
 * Resolves the backing root directory handle on demand. Called lazily — never
 * at import time or at repository-construction time — so the module and a
 * constructed-but-unused repository stay SSR-safe.
 */
export type WebFsRootProvider = () => Promise<WebFsDirectoryHandle>;

/**
 * Accepted forms of the `root` constructor option: a directory handle (a real
 * `FileSystemDirectoryHandle` or any object satisfying
 * {@link WebFsDirectoryHandle}), or a provider resolving one lazily. The
 * explicit `FileSystemDirectoryHandle` union member exists so a real handle
 * typechecks even under `lib` configurations whose DOM types omit the
 * async-iteration members — at runtime the shapes are identical.
 */
export type WebFsRootInput =
  | WebFsDirectoryHandle
  | FileSystemDirectoryHandle
  | (() =>
    | WebFsDirectoryHandle
    | FileSystemDirectoryHandle
    | Promise<WebFsDirectoryHandle | FileSystemDirectoryHandle>);
