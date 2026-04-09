import '@standard-schema/spec';
import * as S from 'effect/Schema';

/**
 * URLs for accessing an asset.
 *
 * Different URL types serve different purposes:
 * - download: Direct download of the original file
 * - view: Inline viewing (Content-Disposition: inline)
 * - public: Permanent public URL (if asset is public)
 */
export const AssetUrlSchema = S.toStandardSchemaV1(S.Struct({
  /**
   * The asset key these URLs belong to.
   */
  key: S.String,

  /**
   * Direct download URL for the asset.
   */
  url: S.optional(S.String),

  /**
   * Expiration time for signed URLs (if applicable).
   * ISO 8601 date string.
   */
  expiresAt: S.optional(S.DateTimeUtcFromString),
}));

export type AssetUrl = S.Schema.Type<typeof AssetUrlSchema>;
