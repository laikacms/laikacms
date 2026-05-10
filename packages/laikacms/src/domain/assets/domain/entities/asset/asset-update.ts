import * as S from 'effect/Schema';

/**
 * Data for updating an existing asset's metadata.
 * Note: To replace the content, use the multipart upload flow.
 */
export const AssetUpdateSchema = S.toStandardSchemaV1(S.Struct({
  /** Key/path of the asset to update */
  key: S.String.check(S.isMaxLength(1023)),

  /** Updated custom metadata (replaces existing) */
  customMetadata: S.optional(S.Record(S.String, S.String)),

  /** Updated cache control header value */
  cacheControl: S.optional(S.String),

  /** Updated MIME type (if content type needs correction) */
  mimeType: S.optional(S.String),
}));

export type AssetUpdate = S.Schema.Type<typeof AssetUpdateSchema>;
