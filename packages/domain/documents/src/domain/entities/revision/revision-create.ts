import { z } from "zod";
import { revisionZ } from "./revision.js";
import { storageObjectCreateZ } from "@laikacms/storage";

export const revisionCreateZ = revisionZ.omit({
  createdAt: true,
  updatedAt: true,
})
export type RevisionCreate = z.infer<typeof revisionCreateZ>
