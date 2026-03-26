import { atomBaseZ } from '@laikacms/storage';
import { z } from 'zod';

/**
 * Summary schema for unpublished documents (used in list operations)
 */
export const unpublishedSummaryZ = atomBaseZ.extend({
  type: z.literal('unpublished-summary'),
  status: z.string(),
});

export type UnpublishedSummary = z.infer<typeof unpublishedSummaryZ>;
