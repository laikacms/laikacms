import { isoDateWithFallbackZ } from "@laikacms/core";
import { z } from "zod";

export const storageObjectSummaryZ = z.object({
  type: z.literal('object-summary'),

  key: z.string().max(1023, 'Key cannot be longer than 1023 characters'),

  createdAt: isoDateWithFallbackZ().optional(),
  updatedAt: isoDateWithFallbackZ().optional(),
})

export type StorageObjectSummary = z.infer<typeof storageObjectSummaryZ>;
