import { z } from "zod";
import { storageObjectZ } from "./storage-object.js";

export const storageObjectCreateZ = storageObjectZ.omit({
  createdAt: true,
  updatedAt: true,
})

export type StorageObjectCreate = z.infer<typeof storageObjectCreateZ>