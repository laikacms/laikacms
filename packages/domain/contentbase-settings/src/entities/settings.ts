import { StorageFormatSchema } from '@laikacms/storage';
import { JSONSchema7 } from 'json-schema';
import * as S from 'effect/Schema';

/**
 * Configuration for an unpublished status
 * Each status maps to a directory where unpublished documents with that status are stored
 */
export const UnpublishedStatusConfigSchema = S.Struct({
  /** Directory where documents with this status are stored (relative to .contentbase/[collection]/) */
  directory: S.String,
  /** Human-readable name for this status */
  name: S.String,
});

export type UnpublishedStatusConfig = S.Schema.Type<typeof UnpublishedStatusConfigSchema>;

/**
 * Default unpublished statuses that replace the old draft/archive/trash system
 */
export const defaultUnpublishedStatuses: Record<string, UnpublishedStatusConfig> = {
  draft: { directory: 'draft', name: 'Draft' },
  pending_review: { directory: 'pending_review', name: 'Pending Review' },
  pending_publish: { directory: 'pending_publish', name: 'Pending Publish' },
  archived: { directory: 'archived', name: 'Archived' },
  trash: { directory: 'trash', name: 'Trash' },
};

export const DocumentCollectionSettingsSchema = S.Struct({
  type: S.Literal('document'),
  key: S.String,
  name: S.optional(S.String),
  directory: S.optional(S.String),
  recursive: S.optional(S.Boolean),
  format: S.optional(StorageFormatSchema),
  documentTitleKey: S.optional(S.String),
  documentDescriptionKey: S.optional(S.String),
  documentStatusKey: S.optional(S.String),
  /**
   * Map of unpublished status values to their configuration
   * The key is the status value stored in the 'unpublished' document type's 'status' field
   * Documents with these statuses are stored in .contentbase/[collection]/[status.directory]
   */
  unpublishedStatuses: S.optional(S.Record(S.String, UnpublishedStatusConfigSchema)),
  /**
   * Directory for storing revisions (version history)
   */
  revisionDirectory: S.optional(S.String),
  // Legacy fields - kept for backwards compatibility but deprecated
  /** @deprecated Use unpublishedStatuses instead */
  draftDirectory: S.optional(S.String),
  /** @deprecated Use unpublishedStatuses instead */
  archiveDirectory: S.optional(S.String),
  /** @deprecated Use unpublishedStatuses instead */
  trashDirectory: S.optional(S.String),
});

export type DocumentCollectionSettings = S.Schema.Type<typeof DocumentCollectionSettingsSchema>;

export const MediaCollectionSettingsSchema = S.Struct({
  type: S.Literal('media'),
  key: S.String,
  name: S.optional(S.String),
  directory: S.optional(S.String),
  recursive: S.optional(S.Boolean),
  accept: S.optional(S.Array(S.String)),
  /*
    Example: 'https://example.com/_uploads/{filename}'
  */
  url: S.optional(S.String),
  pathFormat: S.optional(S.String),
});

export type MediaCollectionSettings = S.Schema.Type<typeof MediaCollectionSettingsSchema>;

export const CollectionSettingsSchema = S.Union([
  DocumentCollectionSettingsSchema,
  MediaCollectionSettingsSchema,
]);

export type CollectionSettings = S.Schema.Type<typeof CollectionSettingsSchema>;

export const ContentBaseSettingsSchema = S.Struct({
  collections: S.optional(S.Record(S.String, CollectionSettingsSchema)),
});

export type ContentBaseSettings = S.Schema.Type<typeof ContentBaseSettingsSchema>;
