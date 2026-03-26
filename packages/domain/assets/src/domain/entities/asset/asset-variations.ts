import { z } from 'zod';

/**
 * A single variation of an asset.
 * 
 * Variations are typically resized/optimized versions of the original asset
 * for display purposes (thumbnails, responsive images, etc.).
 */
export const assetVariationZ = z.object({
  /**
   * Unique identifier for this variation.
   * Examples: 'thumbnail', 'small', 'medium', 'large', '100x100', 'webp'
   */
  variant: z.string(),
  
  /**
   * URL to access this variation.
   * May be a signed URL with expiration.
   */
  url: z.string().url(),
  
  /**
   * Width in pixels (if applicable).
   */
  width: z.number().int().positive().optional(),
  
  /**
   * Height in pixels (if applicable).
   */
  height: z.number().int().positive().optional(),
  
  /**
   * MIME type of the variation (may differ from original).
   * Example: Original is PNG, variation is WebP.
   */
  mimeType: z.string().optional(),
  
  /**
   * Size in bytes (if known).
   */
  size: z.number().int().nonnegative().optional(),
});

export type AssetVariation = z.infer<typeof assetVariationZ>;

/**
 * Collection of variations for an asset.
 */
export const assetVariationsZ = z.object({
  /**
   * The asset key these variations belong to.
   */
  key: z.string(),
  
  /**
   * Available variations.
   */
  variations: z.record(z.string(), assetVariationZ),
});

export type AssetVariations = z.infer<typeof assetVariationsZ>;
