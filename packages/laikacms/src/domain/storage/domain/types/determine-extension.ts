import type { StorageObjectMetadata } from '../entities/object/storage-object-metadata.js';

/**
 * Context handed to a `DetermineExtension` callback when the storage is about to
 * write a new object.
 */
export interface DetermineExtensionContext {
  /**
   * Optional metadata supplied with the create/update call. The default
   * implementation treats `metadata.extension` as an authoritative hint.
   */
  metadata?: StorageObjectMetadata;
  /**
   * The storage's configured `defaultFileExtension`. Convenient for callbacks that
   * want to fall back deterministically.
   */
  defaultExtension: string;
}

/**
 * Storage-side policy for picking the on-disk file extension when a new object is
 * about to be written. Returning `undefined` lets the storage fall back to its
 * `defaultFileExtension`.
 */
export type DetermineExtension = (
  key: string,
  context: DetermineExtensionContext,
) => string | undefined;

/**
 * The default `DetermineExtension` policy. Honors `metadata.extension` when present
 * and otherwise falls back to the storage's `defaultExtension`.
 *
 * Storage implementations use this when no explicit callback is supplied; user-
 * supplied callbacks fully replace it (they may delegate to it manually if desired).
 */
export const defaultDetermineExtension: DetermineExtension = (_key, { metadata, defaultExtension }) =>
  metadata?.extension ?? defaultExtension;
