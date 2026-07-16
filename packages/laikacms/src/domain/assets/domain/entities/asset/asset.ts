import * as S from 'effect/Schema';
import { AtomBaseSchema, StorageObjectContentSchema } from 'laikacms/storage';

/**
 * Asset extends StorageObject with a different type discriminator.
 *
 * The content field is inherited from StorageObject and contains
 * implementation-specific data. The implementation decides what to store.
 *
 * Previews, URLs, and metadata are NOT stored in the asset itself.
 * Instead, use the repository methods:
 * - getPreviews(key) - Get preview URLs for an asset
 * - getUrls(key) - Get access URLs for an asset
 * - getMetadata(key) - Get metadata for an asset
 *
 * This decoupling allows:
 * 1. Implementations to generate URLs/previews on-demand
 * 2. Different caching strategies for different data types
 * 3. Lazy loading of expensive-to-compute data
 */
export const AssetSchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('asset'),
  content: StorageObjectContentSchema,

  /**
   * Opaque per-record version token: changes if and only if the asset's
   * content changed, and is comparable only by equality. A git blob or commit
   * sha, a database row version, and an R2 ETag are all valid
   * implementations. Optional so repositories without version tracking stay
   * valid; see `AssetsCapabilities.versionTracking`.
   */
  version: S.optional(S.String),
}));

export type Asset = S.Schema.Type<typeof AssetSchema>;

// Re-export content type for convenience
export type AssetContent = S.Schema.Type<typeof StorageObjectContentSchema>;
