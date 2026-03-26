import { isoDateWithFallbackZ } from "@laikacms/core";
import { z } from "zod";

export const folderSummaryZ = z.object({
  type: z.literal('folder-summary'),
  key: z.string().max(1023, 'Key cannot be longer than 1023 characters'),

  createdAt: isoDateWithFallbackZ().optional(),
  updatedAt: isoDateWithFallbackZ().optional(),
})

export type FolderSummary = z.infer<typeof folderSummaryZ>