import * as S from 'effect/Schema';

/**
 * A single variation of an asset.
 * 
 * Variations are typically resized/optimized versions of the original asset
 * for display purposes (thumbnails, responsive images, etc.).
 */
export const AssetVariationSchema = S.toStandardSchemaV1(S.Struct({
  /**
   * Unique identifier for this variation.
   * Examples: 'thumbnail', 'small', 'medium', 'large', '100x100', 'webp'
   */
  variant: S.String,
  
  /**
   * URL to access this variation.
   * May be a signed URL with expiration.
   */
  url: S.String,
  
  /**
   * Width in pixels (if applicable).
   */
  width: S.optional(S.Number.check(S.isInt()).check(S.isGreaterThan(0))),
  
  /**
   * Height in pixels (if applicable).
   */
  height: S.optional(S.Number.check(S.isInt()).check(S.isGreaterThan(0))),
  
  /**
   * MIME type of the variation (may differ from original).
   * Example: Original is PNG, variation is WebP.
   */
  mimeType: S.optional(S.String),
  
  /**
   * Size in bytes (if known).
   */
  size: S.optional(S.Number.check(S.isInt()).check(S.isGreaterThan(0))),
}));

export type AssetVariation = S.Schema.Type<typeof AssetVariationSchema>;

/**
 * Collection of variations for an asset.
 */
export const AssetVariationsSchema = S.toStandardSchemaV1(S.Struct({
  /**
   * The asset key these variations belong to.
   */
  key: S.String,
  
  /**
   * Available variations.
   */
  variations: S.Record(S.String, AssetVariationSchema),
}));

export type AssetVariations = S.Schema.Type<typeof AssetVariationsSchema>;
