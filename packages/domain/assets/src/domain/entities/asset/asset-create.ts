import * as S from 'effect/Schema';
/**
 * Browser-compatible binary content type.
 * Supports Uint8Array (works in both browser and Node.js),
 * ArrayBuffer, and ReadableStream for streaming uploads.
 */
export type BinaryContent = Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>;

// Define a string schema with a filter to ensure the string
// is at least 10 characters long

export const BinaryContentSchema = S.declare<BinaryContent>(
  (val): val is BinaryContent => val instanceof Uint8Array || val instanceof ArrayBuffer ||
    (typeof ReadableStream !== 'undefined' && val instanceof ReadableStream),
  { message: 'Content must be Uint8Array, ArrayBuffer, or ReadableStream<Uint8Array>' }
)

/**
 * Data required to create a new asset.
 * Used for simple single-request uploads.
 */

export const AssetCreateSchema = S.Struct({
  /** Key/path for the asset (without extension) */
  key: S.String.pipe(S.check(S.isMaxLength(1023))),

  /**
   * The binary content of the asset.
   * Accepts Uint8Array, ArrayBuffer, or ReadableStream<Uint8Array>.
   */
  content: BinaryContentSchema,

  /** MIME type of the asset */
  mimeType: S.String,

  /** Original filename (optional) */
  filename: S.optional(S.String),

  /** Custom metadata to store with the asset */
  customMetadata: S.optional(S.Record(S.String, S.String)),

  /** Cache control header value */
  cacheControl: S.optional(S.String),
});

export type AssetCreate = S.Schema.Type<typeof AssetCreateSchema>;
