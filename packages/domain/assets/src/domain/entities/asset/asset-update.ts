import { z } from 'zod';

/**
 * Data for updating an existing asset's metadata.
 * Note: To replace the content, use the multipart upload flow.
 */
export const assetUpdateZ = z.object({
  /** Key/path of the asset to update */
  key: z.string().max(1023, "Key cannot be longer than 1023 characters"),
  
  /** Updated custom metadata (replaces existing) */
  customMetadata: z.record(z.string(), z.string()).optional(),
  
  /** Updated cache control header value */
  cacheControl: z.string().optional(),
  
  /** Updated MIME type (if content type needs correction) */
  mimeType: z.string().optional(),
});

export type AssetUpdate = z.infer<typeof assetUpdateZ>;
