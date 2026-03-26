import { atomBaseZ, storageObjectContentZ } from '@laikacms/storage';
import { z } from 'zod';

/**
 * Unpublished document entity
 * 
 * This is a unified type that replaces the separate draft, archive, and trash types.
 * The status field determines the current state of the unpublished document.
 * Documents are stored in .contentbase/[collection]/[status]/ directories.
 */
export const unpublishedZ = atomBaseZ.extend({
  type: z.literal('unpublished'),
  /**
   * The status of the unpublished document.
   * This maps to the unpublishedStatuses configuration in collection settings.
   * Common values: 'draft', 'pending_review', 'pending_publish', 'archived', 'trash'
   */
  status: z.string(),
  content: storageObjectContentZ,
});

export type Unpublished = z.infer<typeof unpublishedZ>;
