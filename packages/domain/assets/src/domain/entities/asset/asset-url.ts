import { isoDateWithFallbackZ } from '@laikacms/core';
import { z } from 'zod';

/**
 * URLs for accessing an asset.
 * 
 * Different URL types serve different purposes:
 * - download: Direct download of the original file
 * - view: Inline viewing (Content-Disposition: inline)
 * - public: Permanent public URL (if asset is public)
 */
export const assetUrlZ = z.object({
  /**
   * The asset key these URLs belong to.
   */
  key: z.string(),
  
  /** 
   * Direct download URL for the asset.
   */
  url: z.string().optional(),
  
  /**
   * Expiration time for signed URLs (if applicable).
   * ISO 8601 date string.
   */
  expiresAt: isoDateWithFallbackZ().optional(),
});

export type AssetUrl = z.infer<typeof assetUrlZ>;
