import { z } from 'zod';

/**
 * Browser-compatible binary content type.
 * Supports Uint8Array (works in both browser and Node.js),
 * ArrayBuffer, and ReadableStream for streaming uploads.
 */
export type BinaryContent = Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>;

/**
 * Data required to create a new asset.
 * Used for simple single-request uploads.
 */
export const assetCreateZ = z.object({
  /** Key/path for the asset (without extension) */
  key: z.string().max(1023, "Key cannot be longer than 1023 characters"),
  
  /**
   * The binary content of the asset.
   * Accepts Uint8Array, ArrayBuffer, or ReadableStream<Uint8Array>.
   * Note: Zod validation is relaxed here; runtime type checking is recommended.
   */
  content: z.custom<BinaryContent>(
    (val) => val instanceof Uint8Array || val instanceof ArrayBuffer ||
             (typeof ReadableStream !== 'undefined' && val instanceof ReadableStream),
    { message: 'Content must be Uint8Array, ArrayBuffer, or ReadableStream<Uint8Array>' }
  ),
  
  /** MIME type of the asset */
  mimeType: z.string(),
  
  /** Original filename (optional) */
  filename: z.string().optional(),
  
  /** Custom metadata to store with the asset */
  customMetadata: z.record(z.string(), z.string()).optional(),
  
  /** Cache control header value */
  cacheControl: z.string().optional(),
});

export type AssetCreate = z.infer<typeof assetCreateZ>;
