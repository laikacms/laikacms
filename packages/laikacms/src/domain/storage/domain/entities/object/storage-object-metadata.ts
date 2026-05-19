import * as S from 'effect/Schema';

/**
 * Optional, capability-driven metadata attached to a storage object.
 *
 * Each field is meaningful only when the corresponding storage capability is supported
 * (see `Capabilities` returned by `StorageRepository.getCapabilities`). Implementations
 * that don't support a capability ignore the field on writes and omit it on reads.
 *
 * Backend-specific extras may live alongside the standard fields below and should
 * stay namespaced to avoid collisions; consumers that don't recognize a key should
 * preserve it on round-trips.
 */
export const StorageObjectMetadataSchema = S.toStandardSchemaV1(S.Struct({
  /**
   * File extension to use when (de)serializing this object. Active on backends whose
   * `Capabilities.fileExtensions.supported` is `true`. Must match a key in
   * `Capabilities.fileExtensions.supportedExtensions`.
   *
   * On writes: hint to the backend to use this extension's serializer.
   * On reads: the extension the backend used to (de)serialize the object.
   */
  extension: S.optional(S.String),

  /**
   * Backend-specific revision identifier (e.g., GitHub commit SHA, R2 ETag, version ID).
   * Active on backends that track per-object revisions.
   */
  revisionId: S.optional(S.String),
}));

export type StorageObjectMetadata = S.Schema.Type<typeof StorageObjectMetadataSchema>;
