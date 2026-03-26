import { atomBaseZ, storageObjectSummaryZ } from "@laikacms/storage";
import { z } from "zod";

export const revisionSummaryZ = storageObjectSummaryZ.extend({
  type: z.literal('revision-summary'),
  revision: z.string(),
})
export type RevisionSummary = z.infer<typeof revisionSummaryZ>
