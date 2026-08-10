import * as Cause from 'effect/Cause';
import * as Result from 'effect/Result';

import {
  DirInsteadOfFile,
  FileInsteadOfDir,
  ForbiddenError,
  IllegalStateException,
  InternalError,
  InvalidData,
  LaikaError,
  type LaikaResult,
  NotFoundError,
  PermissionDeniedError,
  PermissionPromptRequiredError,
  QuotaExceededError,
  StaleHandleError,
} from 'laikacms/core';
import type { Key } from 'laikacms/storage';

import type { WebFsEntry } from '../../domain/entities/web-fs-entry.js';
import type {
  WebFsAccessMode,
  WebFsDirectoryHandle,
  WebFsFileHandle,
  WebFsPermissionState,
  WebFsRootProvider,
} from '../../domain/types/web-fs-handles.js';

// Reject keys containing "", "." or ".." segments, preventing path-traversal
// reads/writes outside the configured root — the same concern LCMS-199
// addressed for `storage-fs`. The File System API itself also rejects these
// names, but validating up front yields a typed `InvalidData` instead of a
// `TypeError`.
const TRAVERSAL_ERROR = 'Object key escapes the configured content root';

/** Normalize a logical key into validated path segments. Throws {@link InvalidData} on traversal attempts. */
const keyToSegments = (key: Key): string[] => {
  const normalized = key.replace(/^\/+|\/+$/g, '');
  if (normalized === '') return [];
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new InvalidData(TRAVERSAL_ERROR);
    }
  }
  return segments;
};

const domExceptionName = (error: unknown): string | null =>
  typeof DOMException !== 'undefined' && error instanceof DOMException ? error.name : null;

const isQuotaError = (error: unknown): boolean => error instanceof Error && error.name === 'QuotaExceededError';

const mapWebFsError = (error: unknown, message: string): LaikaError => {
  // Errors already typed by this module (e.g. `IllegalStateException` from a
  // missing default root during SSR, or `InvalidData` from a traversal
  // attempt) pass through unchanged rather than being masked as a generic
  // `InternalError`.
  if (error instanceof LaikaError) return error;
  if (isQuotaError(error)) return new QuotaExceededError(message, { cause: error });
  switch (domExceptionName(error)) {
    case 'NotFoundError':
      return new NotFoundError(message, { cause: error });
    case 'TypeMismatchError':
      // Reachable from `getDirectoryHandle` over an existing file; the inverse
      // case (`getFileHandle` over a directory) is mapped at its call sites.
      return new FileInsteadOfDir(message, { cause: error });
    case 'InvalidModificationError':
    case 'NoModificationAllowedError':
      return new ForbiddenError(message, { cause: error });
    case 'NotAllowedError':
    case 'SecurityError':
      // Access was revoked (or never granted for this mode — e.g. a write on a
      // `'read'`-granted handle). Re-requesting permission may fix it, but the
      // repository never prompts itself; the application does, in a gesture.
      return new PermissionDeniedError(message, { cause: error });
    default:
      return new InternalError(message, { cause: Cause.fail(error) });
  }
};

/** An object resolved to its physical file-system location. */
interface ResolvedObject {
  /** The directory containing the file — kept so callers can `removeEntry` without re-walking. */
  parent: WebFsDirectoryHandle;
  handle: WebFsFileHandle;
  /** The file's physical name including its extension. */
  physicalName: string;
  /** The extension-free logical key. */
  logicalKey: string;
  extension: string;
}

/**
 * `WebFsDataSource` provides low-level operations for interacting with a web
 * File System API directory tree — any object satisfying the
 * {@link WebFsDirectoryHandle} contract, whether it points into the
 * origin-private file system or a user-picked on-disk directory; where the
 * handle came from is deliberately none of this module's business. Unlike the
 * flat stores (`storage-r2`, `storage-web`) there is no simulated hierarchy:
 * folders are real directories, empty folders exist without `.keep` markers,
 * and object contents are stored as raw files (readable by any other consumer
 * of the same directory tree).
 *
 * All operations are scoped under `${namespace}` — a real subdirectory chain
 * below the provided root — so repositories sharing one root under different
 * namespaces never observe each other's entries (or unrelated data already in
 * the same tree). File extensions are handled transparently and encoded in
 * the physical file name, mirroring the other storage implementations.
 */
export class WebFsDataSource {
  private readonly namespaceSegments: string[];

  constructor(
    private readonly rootProvider: WebFsRootProvider,
    namespace: string,
    private readonly availableExtensions: string[] = [],
    private readonly mode: WebFsAccessMode = 'readwrite',
  ) {
    this.namespaceSegments = keyToSegments(namespace);
  }

  /**
   * Resolve the root handle and verify it is actually usable, so every
   * operation fails with an actionable typed error instead of a misleading
   * one. Three gates, in order:
   *
   * 1. The provider itself — a provider that throws (e.g. the application's
   *    handle lookup failed or nothing was stored yet) surfaces as
   *    `IllegalStateException`, not a defect.
   * 2. `queryPermission({ mode })` — a persisted user-picked handle commonly
   *    lapses back to `'prompt'` when restored in a later session; browsers
   *    also change these policies over time. The repository never calls
   *    `requestPermission()` (it needs a user gesture and is unavailable in
   *    service workers); it fails typed and the application re-prompts.
   *    Handles without `queryPermission` (origin-private roots, non-Chromium
   *    engines) proceed as granted. The state is re-checked on every
   *    operation — permission is revocable mid-session and the query is
   *    cheap.
   * 3. A liveness probe (first-entry read) — a handle can be `'granted'` yet
   *    point at a directory that was deleted or moved, or be a persisted
   *    handle that expired; `queryPermission` tracks permission, not
   *    existence. Without the probe, the stale root's `NotFoundError` is
   *    swallowed by the `create: false` walk and misreported as "folder does
   *    not exist". A directory deleted *after* the probe still surfaces as a
   *    child-path `NotFoundError` — that race is unavoidable without wrapping
   *    every handle call.
   */
  private async resolveRoot(): Promise<WebFsDirectoryHandle> {
    let root: WebFsDirectoryHandle;
    try {
      root = await this.rootProvider();
    } catch (error) {
      if (error instanceof LaikaError) throw error;
      throw new IllegalStateException(
        'WebFsStorageRepository: the root directory provider threw while resolving the handle '
          + "(e.g. the application's handle lookup failed or no handle was stored yet).",
        { cause: error },
      );
    }
    if (typeof root.queryPermission === 'function') {
      let state: WebFsPermissionState;
      try {
        state = await root.queryPermission({ mode: this.mode });
      } catch (error) {
        throw new StaleHandleError(
          'The stored directory handle is no longer usable; ask the user to pick the directory again.',
          { cause: error },
        );
      }
      if (state === 'prompt') {
        throw new PermissionPromptRequiredError(
          `Permission for '${this.mode}' access to the root directory must be re-requested via `
            + 'requestPermission() inside a user gesture; this repository never prompts itself.',
        );
      }
      if (state !== 'granted') {
        throw new PermissionDeniedError(
          `'${this.mode}' access to the root directory was denied; the user must grant access anew.`,
        );
      }
    }
    try {
      await root.entries()[Symbol.asyncIterator]().next();
    } catch (error) {
      throw new StaleHandleError(
        'The stored directory handle no longer connects to an existing directory (it was deleted or '
          + 'moved, or the persisted handle expired). Ask the user to pick the directory again.',
        { cause: error },
      );
    }
    return root;
  }

  private stripExtension(name: string): string {
    for (const ext of this.availableExtensions) {
      if (name.endsWith(`.${ext}`)) return name.slice(0, -(ext.length + 1));
    }
    return name;
  }

  /**
   * Walk `segments` below the (namespaced) root. With `create: false` a
   * missing directory — or a file occupying a segment's name — resolves to
   * `null` ("the path does not exist as a directory"). With `create: true`
   * missing directories are created and a file in the way surfaces as a
   * `TypeMismatchError`, mapped to `FileInsteadOfDir` by the caller's
   * catch-all.
   */
  private async resolveDirectory(segments: string[], create: boolean): Promise<WebFsDirectoryHandle | null> {
    let current = await this.resolveRoot();
    for (const segment of [...this.namespaceSegments, ...segments]) {
      try {
        current = await current.getDirectoryHandle(segment, { create });
      } catch (error) {
        const name = domExceptionName(error);
        if (!create && (name === 'NotFoundError' || name === 'TypeMismatchError')) return null;
        throw error;
      }
    }
    return current;
  }

  /** Resolve a logical key to its physical file by probing each available extension. `null` when absent. */
  private async resolveObject(key: Key): Promise<ResolvedObject | null> {
    const segments = keyToSegments(key);
    // The (namespace) root is a folder, never an object.
    if (segments.length === 0) return null;
    const parentSegments = segments.slice(0, -1);
    const base = this.stripExtension(segments[segments.length - 1]);
    const parent = await this.resolveDirectory(parentSegments, false);
    if (!parent) return null;
    for (const ext of this.availableExtensions) {
      const physicalName = ext ? `${base}.${ext}` : base;
      try {
        const handle = await parent.getFileHandle(physicalName);
        return {
          parent,
          handle,
          physicalName,
          logicalKey: [...parentSegments, base].join('/'),
          extension: ext,
        };
      } catch (error) {
        const name = domExceptionName(error);
        // TypeMismatchError: a directory occupies this physical name — not this object.
        if (name === 'NotFoundError' || name === 'TypeMismatchError') continue;
        throw error;
      }
    }
    return null;
  }

  /** Check if an object exists with any of the available extensions. Returns the extension if found. */
  async findExistingObjectExtension(key: Key): Promise<string | null> {
    try {
      const resolved = await this.resolveObject(key);
      return resolved?.extension ?? null;
    } catch {
      return null;
    }
  }

  async getObjectContents(key: Key): Promise<LaikaResult<{ content: string, key: string, extension: string }>> {
    try {
      const resolved = await this.resolveObject(key);
      if (!resolved) return Result.fail(new NotFoundError(`Object at ${key} does not exist`));
      const file = await resolved.handle.getFile();
      const content = await file.text();
      return Result.succeed({ content, key: resolved.logicalKey, extension: resolved.extension });
    } catch (error) {
      return Result.fail(mapWebFsError(error, `Failed to read object at ${key}`));
    }
  }

  /**
   * The File System API keeps a single timestamp per file
   * (`File.lastModified`); creation
   * time is not recorded, so `createdAt` falls back to the last modification —
   * the same degradation `storage-fs` applies on filesystems without a birth
   * time.
   */
  async getObjectMeta(key: Key): Promise<
    LaikaResult<{ createdAt: Date, updatedAt: Date, key: string, extension: string }>
  > {
    try {
      const resolved = await this.resolveObject(key);
      if (!resolved) return Result.fail(new NotFoundError(`Object at ${key} does not exist`));
      const file = await resolved.handle.getFile();
      const lastModified = new Date(file.lastModified);
      return Result.succeed({
        createdAt: lastModified,
        updatedAt: lastModified,
        key: resolved.logicalKey,
        extension: resolved.extension,
      });
    } catch (error) {
      return Result.fail(mapWebFsError(error, `Failed to read metadata for object at ${key}`));
    }
  }

  /**
   * Folders are real directories, so existence is a direct handle
   * lookup — no prefix scanning or `.keep` markers. Timestamps are
   * synthesized: the File System API exposes none for directories.
   */
  async getFolderMeta(key: Key): Promise<LaikaResult<{ createdAt: Date, updatedAt: Date }>> {
    try {
      const dir = await this.resolveDirectory(keyToSegments(key), false);
      if (!dir) return Result.fail(new NotFoundError(`Folder at ${key} does not exist`));
      const now = new Date();
      return Result.succeed({ createdAt: now, updatedAt: now });
    } catch (error) {
      return Result.fail(mapWebFsError(error, `Failed to read metadata for folder at ${key}`));
    }
  }

  /**
   * List the immediate children of `prefix` (one level — same semantics as the
   * other storage implementations' directory listings). An existing empty
   * directory yields an empty array; only a genuinely missing directory is a
   * `NotFoundError`.
   */
  async listDirectory(prefix: Key): Promise<LaikaResult<WebFsEntry[]>> {
    try {
      const segments = keyToSegments(prefix);
      const dir = await this.resolveDirectory(segments, false);
      if (!dir) return Result.fail(new NotFoundError(`Folder at ${prefix} does not exist`));
      const searchPrefix = segments.length > 0 ? `${segments.join('/')}/` : '';
      const entries: WebFsEntry[] = [];
      for await (const [name, handle] of dir.entries()) {
        entries.push({
          type: handle.kind === 'directory' ? 'dir' : 'file',
          key: `${searchPrefix}${name}`,
        });
      }
      return Result.succeed(entries);
    } catch (error) {
      return Result.fail(mapWebFsError(error, `Failed to list folder at ${prefix}`));
    }
  }

  async createOrUpdate(key: Key, content: string, extension: string): Promise<LaikaResult<{ key: string }>> {
    try {
      const segments = keyToSegments(key);
      if (segments.length === 0) {
        return Result.fail(new InvalidData('Object key must not be empty'));
      }
      const parentSegments = segments.slice(0, -1);
      const base = this.stripExtension(segments[segments.length - 1]);
      const physicalName = extension ? `${base}.${extension}` : base;

      // With `create: true` the walk cannot resolve to null.
      const parent = (await this.resolveDirectory(parentSegments, true))!;
      let handle: WebFsFileHandle;
      try {
        handle = await parent.getFileHandle(physicalName, { create: true });
      } catch (error) {
        if (domExceptionName(error) === 'TypeMismatchError') {
          throw new DirInsteadOfFile(`The path ${key} is a directory`, { cause: error });
        }
        throw error;
      }
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return Result.succeed({ key: [...parentSegments, base].join('/') });
    } catch (error) {
      return Result.fail(mapWebFsError(error, `Failed to write object at ${key}`));
    }
  }

  /** Create a real (possibly empty) directory chain — no `.keep` marker involved. */
  async createFolder(key: Key): Promise<LaikaResult<void>> {
    try {
      await this.resolveDirectory(keyToSegments(key), true);
      return Result.succeed(undefined);
    } catch (error) {
      return Result.fail(mapWebFsError(error, `Failed to create folder at ${key}`));
    }
  }

  /**
   * Delete atoms by their logical key: objects first, then folders. Folders
   * must be empty — recursive deletion is refused (mirrors `storage-fs`'s
   * security stance).
   */
  async *deleteAtoms(keys: readonly Key[]): AsyncGenerator<LaikaResult<Key>> {
    for (const key of keys) {
      try {
        const resolved = await this.resolveObject(key);
        if (resolved) {
          await resolved.parent.removeEntry(resolved.physicalName);
          yield Result.succeed(resolved.logicalKey);
          continue;
        }
        yield await this.deleteFolder(key);
      } catch (error) {
        yield Result.fail(mapWebFsError(error, `Failed to delete atom at ${key}`));
      }
    }
  }

  private async deleteFolder(key: Key): Promise<LaikaResult<Key>> {
    const segments = keyToSegments(key);
    if (segments.length === 0) {
      return Result.fail(new ForbiddenError('The repository root cannot be deleted'));
    }
    const parent = await this.resolveDirectory(segments.slice(0, -1), false);
    const name = segments[segments.length - 1];
    const dir = parent ? await this.resolveDirectory(segments, false) : null;
    if (!parent || !dir) return Result.fail(new NotFoundError(`Atom at ${key} does not exist`));
    for await (const _ of dir.entries()) {
      return Result.fail(
        new ForbiddenError('Due to security concerns, deleting directories with content is not allowed'),
      );
    }
    await parent.removeEntry(name);
    return Result.succeed(segments.join('/'));
  }
}
