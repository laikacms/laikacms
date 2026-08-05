import * as Cause from 'effect/Cause';
import * as Result from 'effect/Result';

import { InternalError, LaikaError, type LaikaResult, NotFoundError, QuotaExceededError } from 'laikacms/core';
import type { Key } from 'laikacms/storage';

import type { WebStorageEntry } from '../../domain/entities/web-storage-entry.js';

/**
 * Resolves the backing Web `Storage` object on demand. Called lazily — never
 * at import time or at repository-construction time — so the module and a
 * constructed-but-unused repository stay SSR-safe.
 */
export type WebStorageProvider = () => Storage;

/** The JSON envelope persisted at each physical Web Storage key. */
interface WebStorageEnvelope {
  /** The serialized document body, produced by the object's `StorageSerializer`. */
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** Marker file name used to represent an explicitly-created, possibly-empty folder. */
const FOLDER_MARKER = '.keep';

const isQuotaError = (error: unknown): boolean => {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.code === 22;
  }
  return error instanceof Error && error.name === 'QuotaExceededError';
};

const mapStorageError = (error: unknown, message: string): LaikaError => {
  // Errors already typed by this module (e.g. `IllegalStateException` from a
  // missing default `Storage` during SSR) pass through unchanged rather than
  // being masked as a generic `InternalError`.
  if (error instanceof LaikaError) return error;
  if (isQuotaError(error)) return new QuotaExceededError(message, { cause: error });
  return new InternalError(message, { cause: Cause.fail(error) });
};

/**
 * `WebStorageDataSource` provides low-level operations for interacting with a Web
 * `Storage`-shaped backing store (`localStorage`, `sessionStorage`, or an
 * injected in-memory shim). Web Storage is a flat key-value store, so this
 * implementation simulates a hierarchical file system the same way
 * `R2DataSource` does for Cloudflare R2:
 *
 * - Folders are represented by key prefixes.
 * - Empty folders are represented by `.keep` marker entries.
 * - File extensions are handled transparently and encoded in the physical key.
 *
 * Every physical key is namespaced as `${namespace}:${logicalKeyWithExtension}`
 * so that repositories sharing one `Storage` under different namespaces never
 * observe each other's keys (or unrelated data already in that `Storage`) — see
 * {@link listPhysicalEntries}, the single point all reads/writes/listings funnel
 * through for the namespace-prefix filter.
 */
export class WebStorageDataSource {
  constructor(
    private readonly storageProvider: WebStorageProvider,
    private readonly namespace: string,
    private readonly availableExtensions: string[] = [],
  ) {}

  private get storage(): Storage {
    return this.storageProvider();
  }

  private get physicalPrefix(): string {
    return `${this.namespace}:`;
  }

  private normalizeKey(key: Key): Key {
    return key.replace(/^\/+|\/+$/g, '');
  }

  private stripExtension(key: Key): Key {
    for (const ext of this.availableExtensions) {
      if (key.endsWith(`.${ext}`)) return key.slice(0, -(ext.length + 1));
    }
    return key;
  }

  private toPhysicalKey(logicalKeyWithExtension: string): string {
    return `${this.physicalPrefix}${logicalKeyWithExtension}`;
  }

  /** Every physical key in `storage` belonging to this namespace, with the prefix stripped. */
  private listPhysicalEntries(): Array<{ physicalKey: string, logicalKeyWithExtension: string }> {
    const prefix = this.physicalPrefix;
    const store = this.storage;
    const entries: Array<{ physicalKey: string, logicalKeyWithExtension: string }> = [];
    for (let i = 0; i < store.length; i++) {
      const physicalKey = store.key(i);
      if (physicalKey === null || !physicalKey.startsWith(prefix)) continue;
      entries.push({ physicalKey, logicalKeyWithExtension: physicalKey.slice(prefix.length) });
    }
    return entries;
  }

  private readEnvelope(physicalKey: string): WebStorageEnvelope | null {
    const raw = this.storage.getItem(physicalKey);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as WebStorageEnvelope;
    } catch {
      return null;
    }
  }

  private async resolveKeyWithExtension(
    key: Key,
  ): Promise<{ physicalKey: string, logicalKey: string, extension: string } | null> {
    const normalized = this.normalizeKey(key);
    const keyWithoutExt = this.stripExtension(normalized);
    for (const ext of this.availableExtensions) {
      const logicalWithExt = ext ? `${keyWithoutExt}.${ext}` : keyWithoutExt;
      const physicalKey = this.toPhysicalKey(logicalWithExt);
      if (this.readEnvelope(physicalKey) !== null) {
        return { physicalKey, logicalKey: keyWithoutExt, extension: ext };
      }
    }
    return null;
  }

  /** Check if an object exists with any of the available extensions. Returns the extension if found. */
  async findExistingObjectExtension(key: Key): Promise<string | null> {
    try {
      const resolved = await this.resolveKeyWithExtension(key);
      return resolved?.extension ?? null;
    } catch {
      return null;
    }
  }

  async getObjectContents(key: Key): Promise<LaikaResult<{ content: string, key: string, extension: string }>> {
    try {
      const resolved = await this.resolveKeyWithExtension(key);
      if (!resolved) return Result.fail(new NotFoundError(`Object at ${key} does not exist`));
      const envelope = this.readEnvelope(resolved.physicalKey);
      if (!envelope) return Result.fail(new NotFoundError(`Object at ${key} does not exist`));
      return Result.succeed({ content: envelope.body, key: resolved.logicalKey, extension: resolved.extension });
    } catch (error) {
      return Result.fail(mapStorageError(error, `Failed to read object at ${key}`));
    }
  }

  async getObjectMeta(key: Key): Promise<
    LaikaResult<{ createdAt: Date, updatedAt: Date, key: string, extension: string }>
  > {
    try {
      const resolved = await this.resolveKeyWithExtension(key);
      if (!resolved) return Result.fail(new NotFoundError(`Object at ${key} does not exist`));
      const envelope = this.readEnvelope(resolved.physicalKey);
      if (!envelope) return Result.fail(new NotFoundError(`Object at ${key} does not exist`));
      return Result.succeed({
        createdAt: new Date(envelope.createdAt),
        updatedAt: new Date(envelope.updatedAt),
        key: resolved.logicalKey,
        extension: resolved.extension,
      });
    } catch (error) {
      return Result.fail(mapStorageError(error, `Failed to read metadata for object at ${key}`));
    }
  }

  /**
   * A "folder" has no physical record on its own; its existence is implied by
   * any physical key beginning with `${key}/`, or by an explicit `.keep`
   * marker written by {@link createFolder}. Timestamps are synthesized (the
   * flat store keeps none for a synthetic folder).
   */
  async getFolderMeta(key: Key): Promise<LaikaResult<{ createdAt: Date, updatedAt: Date }>> {
    try {
      const normalized = this.normalizeKey(key);
      const prefix = normalized ? `${normalized}/` : '';
      const hasEntries = this.listPhysicalEntries().some(e => e.logicalKeyWithExtension.startsWith(prefix));
      if (!hasEntries) return Result.fail(new NotFoundError(`Folder at ${key} does not exist`));
      const now = new Date();
      return Result.succeed({ createdAt: now, updatedAt: now });
    } catch (error) {
      return Result.fail(mapStorageError(error, `Failed to read metadata for folder at ${key}`));
    }
  }

  /** List the immediate children of `prefix` (one level — same delimiter semantics as R2's `listDirectory`). */
  async listDirectory(prefix: Key): Promise<LaikaResult<WebStorageEntry[]>> {
    try {
      const normalizedPrefix = this.normalizeKey(prefix);
      const searchPrefix = normalizedPrefix ? `${normalizedPrefix}/` : '';

      const dirNames = new Set<string>();
      const entries: WebStorageEntry[] = [];
      let hasAnyListing = false;

      for (const { logicalKeyWithExtension } of this.listPhysicalEntries()) {
        if (searchPrefix && !logicalKeyWithExtension.startsWith(searchPrefix)) continue;
        hasAnyListing = true;
        const tail = logicalKeyWithExtension.slice(searchPrefix.length);
        const sepIdx = tail.indexOf('/');
        if (sepIdx !== -1) {
          dirNames.add(tail.slice(0, sepIdx));
          continue;
        }
        // Skip the folder marker itself — it is not a real entry.
        if (tail === FOLDER_MARKER) continue;
        entries.push({ type: 'file', key: `${searchPrefix}${tail}` });
      }

      for (const dirName of dirNames) entries.push({ type: 'dir', key: `${searchPrefix}${dirName}` });

      // A flat store can't distinguish an empty existing folder from a
      // non-existent one unless a `.keep` marker was written — mirrors R2.
      if (!hasAnyListing) return Result.fail(new NotFoundError(`Folder at ${prefix} does not exist`));

      return Result.succeed(entries);
    } catch (error) {
      return Result.fail(mapStorageError(error, `Failed to list folder at ${prefix}`));
    }
  }

  async createOrUpdate(key: Key, content: string, extension: string): Promise<LaikaResult<{ key: string }>> {
    try {
      const normalized = this.normalizeKey(key);
      const keyWithoutExt = this.stripExtension(normalized);
      const logicalWithExt = extension ? `${keyWithoutExt}.${extension}` : keyWithoutExt;
      const physicalKey = this.toPhysicalKey(logicalWithExt);

      const existing = this.readEnvelope(physicalKey);
      const now = new Date().toISOString();
      const envelope: WebStorageEnvelope = {
        body: content,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.storage.setItem(physicalKey, JSON.stringify(envelope));
      return Result.succeed({ key: keyWithoutExt });
    } catch (error) {
      return Result.fail(mapStorageError(error, `Failed to write object at ${key}`));
    }
  }

  /** Delete objects by their logical key. Directories are not recursively removed (mirrors `storage-r2`). */
  async *deleteObjects(keys: readonly Key[]): AsyncGenerator<LaikaResult<Key>> {
    for (const key of keys) {
      try {
        const resolved = await this.resolveKeyWithExtension(key);
        if (!resolved) {
          yield Result.fail(new NotFoundError(`Object at ${key} does not exist`));
          continue;
        }
        this.storage.removeItem(resolved.physicalKey);
        yield Result.succeed(resolved.logicalKey);
      } catch (error) {
        yield Result.fail(mapStorageError(error, `Failed to delete object at ${key}`));
      }
    }
  }
}
