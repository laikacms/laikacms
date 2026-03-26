import { atomBaseZ, storageObjectContentZ, storageObjectSummaryZ } from '@laikacms/storage';
import { z } from 'zod';

export const documentSummaryZ = storageObjectSummaryZ.extend({
  type: z.literal('published-summary'),
  status: z.literal('published'),
});

export type DocumentSummary = z.infer<typeof documentSummaryZ>;

