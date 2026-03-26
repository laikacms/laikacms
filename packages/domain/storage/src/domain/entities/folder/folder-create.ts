import { z } from "zod";
import { folderZ } from "./folder.js";

export const folderCreateZ = folderZ.omit({
  createdAt: true,
  updatedAt: true,
})

export type FolderCreate = z.infer<typeof folderCreateZ>