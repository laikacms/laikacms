import * as S from 'effect/Schema';

/**
 * Base metadata common to all asset types.
 */
export const BaseMetadataSchema = S.toStandardSchemaV1(S.Struct({
  /**
   * File size in bytes.
   */
  size: S.Number.check(S.isGreaterThan(0)),
  
  /**
   * MIME type of the asset.
   */
  mimeType: S.String,
  
  /**
   * Original filename (if known).
   */
  filename: S.optional(S.String),
  
  /**
   * File extension (without dot).
   */
  extension: S.optional(S.String),
  
  /**
   * Content hash (e.g., MD5, SHA-256) for integrity verification.
   */
  hash: S.optional(S.String),
  
  /**
   * Hash algorithm used (e.g., 'md5', 'sha256').
   */
  hashAlgorithm: S.optional(S.String),
  
  /**
   * When the asset was created.
   */
  createdAt: S.optional(S.DateTimeUtcFromString),
  
  /**
   * When the asset was last modified.
   */
  modifiedAt: S.optional(S.DateTimeUtcFromString),
}));

export type BaseMetadata = S.Schema.Type<typeof BaseMetadataSchema>;

/**
 * Image-specific metadata.
 */
export const ImageMetadata = S.toStandardSchemaV1(S.Struct({
  ...BaseMetadataSchema.fields,

  kind: S.Literal('image'),
  
  /**
   * Image width in pixels.
   */
  width: S.Number.check(S.isGreaterThan(0)),
  
  /**
   * Image height in pixels.
   */
  height: S.Number.check(S.isGreaterThan(0)),
  
  /**
   * Color space (e.g., 'sRGB', 'Adobe RGB').
   */
  colorSpace: S.optional(S.String),
  
  /**
   * Bit depth per channel.
   */
  bitDepth: S.optional(S.Number.check(S.isGreaterThan(0))),
  
  /**
   * Whether the image has an alpha channel.
   */
  hasAlpha: S.optional(S.Boolean),
  
  /**
   * Whether the image is animated (e.g., GIF, APNG).
   */
  animated: S.optional(S.Boolean),
  
  /**
   * EXIF data (if available).
   */
  exif: S.optional(S.Record(S.String, S.Any)),
}));

export type ImageMetadata = S.Schema.Type<typeof ImageMetadata>;

/**
 * Video-specific metadata.
 */
export const VideoMetadata = S.toStandardSchemaV1(S.Struct({
  ...BaseMetadataSchema.fields,

  kind: S.Literal('video'),
  
  /**
   * Video width in pixels.
   */
  width: S.Number.check(S.isGreaterThan(0)),
  
  /**
   * Video height in pixels.
   */
  height: S.Number.check(S.isGreaterThan(0)),
  
  /**
   * Duration in seconds.
   */
  duration: S.Number.check(S.isGreaterThan(0)),
  
  /**
   * Video codec (e.g., 'h264', 'vp9', 'av1').
   */
  videoCodec: S.optional(S.String),
  
  /**
   * Audio codec (e.g., 'aac', 'opus').
   */
  audioCodec: S.optional(S.String),
  
  /**
   * Frame rate (frames per second).
   */
  frameRate: S.optional(S.Number.check(S.isGreaterThan(0))),
  
  /**
   * Video bitrate in bits per second.
   */
  videoBitrate: S.optional(S.Number.check(S.isGreaterThan(0))),
  
  /**
   * Audio bitrate in bits per second.
   */
  audioBitrate: S.optional(S.Number.check(S.isGreaterThan(0))),
  
  /**
   * Number of audio channels.
   */
  audioChannels: S.optional(S.Number.check(S.isGreaterThan(0))),
  
  /**
   * Audio sample rate in Hz.
   */
  audioSampleRate: S.optional(S.Number.check(S.isGreaterThan(0))),
}));

export type VideoMetadata = S.Schema.Type<typeof VideoMetadata>;

/**
 * Audio-specific metadata.
 */
export const AudioMetadata = S.toStandardSchemaV1(S.Struct({
  ...BaseMetadataSchema.fields,

  kind: S.Literal('audio'),
  
  /**
   * Duration in seconds.
   */
  duration: S.Number.check(S.isGreaterThan(0)),
  
  /**
   * Audio codec (e.g., 'mp3', 'aac', 'flac', 'opus').
   */
  codec: S.optional(S.String),
  
  /**
   * Bitrate in bits per second.
   */
  bitrate: S.optional(S.Number.check(S.isGreaterThan(0))),
  
  /**
   * Number of audio channels.
   */
  channels: S.optional(S.Number.check(S.isGreaterThan(0))),
  
  /**
   * Sample rate in Hz.
   */
  sampleRate: S.optional(S.Number.check(S.isGreaterThan(0))),
  
  /**
   * ID3/metadata tags (title, artist, album, etc.).
   */
  tags: S.optional(S.Record(S.String, S.String)),
}));

export type AudioMetadata = S.Schema.Type<typeof AudioMetadata>;

/**
 * Document-specific metadata (PDF, Office docs, etc.).
 */
export const DocumentMetadata = S.toStandardSchemaV1(S.Struct({
  ...BaseMetadataSchema.fields,

  kind: S.Literal('document'),
  
  /**
   * Number of pages (for paginated documents).
   */
  pageCount: S.optional(S.Number.check(S.isGreaterThan(0))),
  
  /**
   * Document title (from metadata).
   */
  title: S.optional(S.String),
  
  /**
   * Document author (from metadata).
   */
  author: S.optional(S.String),
  
  /**
   * Document subject (from metadata).
   */
  subject: S.optional(S.String),
  
  /**
   * Keywords (from metadata).
   */
  keywords: S.optional(S.Array(S.String)),
  
  /**
   * Creation date (from document metadata).
   */
  documentCreatedAt: S.optional(S.DateTimeUtcFromString),
  
  /**
   * Modification date (from document metadata).
   */
  documentModifiedAt: S.optional(S.DateTimeUtcFromString),
}));

export type DocumentMetadata = S.Schema.Type<typeof DocumentMetadata>;

/**
 * Generic binary file metadata (fallback for unknown types).
 */
export const BinaryMetadata = S.toStandardSchemaV1(S.Struct({
  ...BaseMetadataSchema.fields,

  kind: S.Literal('binary'),
}));

export type BinaryMetadata = S.Schema.Type<typeof BinaryMetadata>;

/**
 * Discriminated union of all metadata types.
 * 
 * Use the 'kind' field to narrow the type:
 * ```typescript
 * if (metadata.kind === 'image') {
 *   console.log(metadata.width, metadata.height);
 * }
 * ```
 */
export const AssetMetadataContentSchema = S.Union([
  ImageMetadata,
  VideoMetadata,
  AudioMetadata,
  DocumentMetadata,
  BinaryMetadata,
]);

export type AssetMetadataContent = S.Schema.Type<typeof AssetMetadataContentSchema>;

/**
 * Metadata wrapper with asset key.
 */
export const AssetMetadataSchema = S.toStandardSchemaV1(S.Struct({
  /**
   * The asset key this metadata belongs to.
   */
  key: S.String,
  
  /**
   * The discriminated metadata content.
   */
  metadata: AssetMetadataContentSchema,
}));

export type AssetMetadata = S.Schema.Type<typeof AssetMetadataSchema>;
