import { z } from "zod";
import { documentZ } from "./document.js";
import { storageObjectUpdateZ } from "@laikacms/storage";

export const documentUpdateZ = documentZ.omit({
  createdAt: true,
  updatedAt: true,
}).partial().required({ key: true });

export type DocumentUpdate = z.infer<typeof documentUpdateZ>;

