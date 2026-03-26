import { z } from "zod";
import { storageObjectZ } from "./storage-object.js";

export const storageObjectUpdateZ = storageObjectZ.omit({
  createdAt: true,
  updatedAt: true,
}).partial().required({ key: true });

export type StorageObjectUpdate = z.infer<typeof storageObjectUpdateZ>;
