import { storageFormatZ } from '@laikacms/storage';
import { JSONSchema7 } from 'json-schema';
import { z } from 'zod';

/**
 * Configuration for an unpublished status
 * Each status maps to a directory where unpublished documents with that status are stored
 */
export const unpublishedStatusConfigZ = z.object({
  /** Directory where documents with this status are stored (relative to .contentbase/[collection]/) */
  directory: z.string(),
  /** Human-readable name for this status */
  name: z.string(),
});

export type UnpublishedStatusConfig = z.infer<typeof unpublishedStatusConfigZ>;

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

export const documentCollectionSettingsZ = z.object({
  type: z.literal('document'),
  key: z.string(),
  name: z.string().default('New Document Collection'),
  directory: z.string().default('content'),
  recursive: z.boolean().default(true),
  format: storageFormatZ.optional(),
  documentTitleKey: z.string().default('title').optional(),
  documentDescriptionKey: z.string().default('description').optional(),
  documentStatusKey: z.string().default('status').optional(),
  /**
   * Map of unpublished status values to their configuration
   * The key is the status value stored in the 'unpublished' document type's 'status' field
   * Documents with these statuses are stored in .contentbase/[collection]/[status.directory]
   */
  unpublishedStatuses: z.record(z.string(), unpublishedStatusConfigZ).default(defaultUnpublishedStatuses).optional(),
  /**
   * Directory for storing revisions (version history)
   */
  revisionDirectory: z.string().default('.contentbase/revisions').optional(),
  // Legacy fields - kept for backwards compatibility but deprecated
  /** @deprecated Use unpublishedStatuses instead */
  draftDirectory: z.string().default('.contentbase/drafts').optional(),
  /** @deprecated Use unpublishedStatuses instead */
  archiveDirectory: z.string().default('.contentbase/archive').optional(),
  /** @deprecated Use unpublishedStatuses instead */
  trashDirectory: z.string().default('.contentbase/trash').optional(),
})

export type DocumentCollectionSettings = z.infer<typeof documentCollectionSettingsZ>

export const mediaCollectionSettingsZ = z.object({
  type: z.literal('media'),
  key: z.string(),
  name: z.string().default('New Media Collection'),
  directory: z.string().default('media'),
  recursive: z.boolean().default(true),
  accept: z.array(z.string()).default(['image/*']),
  /*
    Example: 'https://example.com/_uploads/{filename}'
  */
  url: z.string().optional(),
  pathFormat: z.string().default('{filename}').optional()
})

export type MediaCollectionSettings = z.infer<typeof mediaCollectionSettingsZ>

export const collectionSettingsZ = z.discriminatedUnion('type', [
  documentCollectionSettingsZ,
  mediaCollectionSettingsZ
])

export type CollectionSettings = z.infer<typeof collectionSettingsZ>

export const contentBaseSettingsZ = z.object({
  collections: z.record(z.string(), collectionSettingsZ).default({})
})

export type ContentBaseSettings = z.infer<typeof contentBaseSettingsZ>
