import { z } from "zod";
import { documentZ } from "./document.js";
import { storageObjectCreateZ } from "@laikacms/storage";

// Omit status from create schema - it's always 'published' for documents
// and will be added automatically by the repository
export const documentCreateZ = documentZ.omit({
  createdAt: true,
  updatedAt: true,
})
export type DocumentCreate = z.infer<typeof documentCreateZ>
