import { isoDateWithFallbackZ } from '@laikacms/core';
import { z } from 'zod';

/**
 * Base metadata common to all asset types.
 */
export const baseMetadataZ = z.object({
  /**
   * File size in bytes.
   */
  size: z.number().int().nonnegative(),
  
  /**
   * MIME type of the asset.
   */
  mimeType: z.string(),
  
  /**
   * Original filename (if known).
   */
  filename: z.string().optional(),
  
  /**
   * File extension (without dot).
   */
  extension: z.string().optional(),
  
  /**
   * Content hash (e.g., MD5, SHA-256) for integrity verification.
   */
  hash: z.string().optional(),
  
  /**
   * Hash algorithm used (e.g., 'md5', 'sha256').
   */
  hashAlgorithm: z.string().optional(),
  
  /**
   * When the asset was created.
   */
  createdAt: isoDateWithFallbackZ().optional(),
  
  /**
   * When the asset was last modified.
   */
  modifiedAt: isoDateWithFallbackZ().optional(),
});

/**
 * Image-specific metadata.
 */
export const imageMetadataZ = baseMetadataZ.extend({
  kind: z.literal('image'),
  
  /**
   * Image width in pixels.
   */
  width: z.number().int().positive(),
  
  /**
   * Image height in pixels.
   */
  height: z.number().int().positive(),
  
  /**
   * Color space (e.g., 'sRGB', 'Adobe RGB').
   */
  colorSpace: z.string().optional(),
  
  /**
   * Bit depth per channel.
   */
  bitDepth: z.number().int().positive().optional(),
  
  /**
   * Whether the image has an alpha channel.
   */
  hasAlpha: z.boolean().optional(),
  
  /**
   * Whether the image is animated (e.g., GIF, APNG).
   */
  animated: z.boolean().optional(),
  
  /**
   * EXIF data (if available).
   */
  exif: z.record(z.string(), z.any()).optional(),
});

export type ImageMetadata = z.infer<typeof imageMetadataZ>;

/**
 * Video-specific metadata.
 */
export const videoMetadataZ = baseMetadataZ.extend({
  kind: z.literal('video'),
  
  /**
   * Video width in pixels.
   */
  width: z.number().int().positive(),
  
  /**
   * Video height in pixels.
   */
  height: z.number().int().positive(),
  
  /**
   * Duration in seconds.
   */
  duration: z.number().nonnegative(),
  
  /**
   * Video codec (e.g., 'h264', 'vp9', 'av1').
   */
  videoCodec: z.string().optional(),
  
  /**
   * Audio codec (e.g., 'aac', 'opus').
   */
  audioCodec: z.string().optional(),
  
  /**
   * Frame rate (frames per second).
   */
  frameRate: z.number().positive().optional(),
  
  /**
   * Video bitrate in bits per second.
   */
  videoBitrate: z.number().int().positive().optional(),
  
  /**
   * Audio bitrate in bits per second.
   */
  audioBitrate: z.number().int().positive().optional(),
  
  /**
   * Number of audio channels.
   */
  audioChannels: z.number().int().positive().optional(),
  
  /**
   * Audio sample rate in Hz.
   */
  audioSampleRate: z.number().int().positive().optional(),
});

export type VideoMetadata = z.infer<typeof videoMetadataZ>;

/**
 * Audio-specific metadata.
 */
export const audioMetadataZ = baseMetadataZ.extend({
  kind: z.literal('audio'),
  
  /**
   * Duration in seconds.
   */
  duration: z.number().nonnegative(),
  
  /**
   * Audio codec (e.g., 'mp3', 'aac', 'flac', 'opus').
   */
  codec: z.string().optional(),
  
  /**
   * Bitrate in bits per second.
   */
  bitrate: z.number().int().positive().optional(),
  
  /**
   * Number of audio channels.
   */
  channels: z.number().int().positive().optional(),
  
  /**
   * Sample rate in Hz.
   */
  sampleRate: z.number().int().positive().optional(),
  
  /**
   * ID3/metadata tags (title, artist, album, etc.).
   */
  tags: z.record(z.string(), z.string()).optional(),
});

export type AudioMetadata = z.infer<typeof audioMetadataZ>;

/**
 * Document-specific metadata (PDF, Office docs, etc.).
 */
export const documentMetadataZ = baseMetadataZ.extend({
  kind: z.literal('document'),
  
  /**
   * Number of pages (for paginated documents).
   */
  pageCount: z.number().int().positive().optional(),
  
  /**
   * Document title (from metadata).
   */
  title: z.string().optional(),
  
  /**
   * Document author (from metadata).
   */
  author: z.string().optional(),
  
  /**
   * Document subject (from metadata).
   */
  subject: z.string().optional(),
  
  /**
   * Keywords (from metadata).
   */
  keywords: z.array(z.string()).optional(),
  
  /**
   * Creation date (from document metadata).
   */
  documentCreatedAt: isoDateWithFallbackZ().optional(),
  
  /**
   * Modification date (from document metadata).
   */
  documentModifiedAt: isoDateWithFallbackZ().optional(),
});

export type DocumentMetadata = z.infer<typeof documentMetadataZ>;

/**
 * Generic binary file metadata (fallback for unknown types).
 */
export const binaryMetadataZ = baseMetadataZ.extend({
  kind: z.literal('binary'),
});

export type BinaryMetadata = z.infer<typeof binaryMetadataZ>;

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
export const assetMetadataContentZ = z.discriminatedUnion('kind', [
  imageMetadataZ,
  videoMetadataZ,
  audioMetadataZ,
  documentMetadataZ,
  binaryMetadataZ,
]);

export type AssetMetadataContent = z.infer<typeof assetMetadataContentZ>;

/**
 * Metadata wrapper with asset key.
 */
export const assetMetadataZ = z.object({
  /**
   * The asset key this metadata belongs to.
   */
  key: z.string(),
  
  /**
   * The discriminated metadata content.
   */
  metadata: assetMetadataContentZ,
});

export type AssetMetadata = z.infer<typeof assetMetadataZ>;
