import { z } from "zod";
import { revisionZ } from "./revision.js";

export const revisionUpdateZ = revisionZ.omit({
  createdAt: true,
  updatedAt: true,
}).partial().required({ key: true });

export type RevisionUpdate = z.infer<typeof revisionUpdateZ>;
