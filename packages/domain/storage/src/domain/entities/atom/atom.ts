import { z } from "zod"
import { storageObjectZ } from "../object/storage-object.js"
import { folderZ } from "../folder/folder.js"

export const atomZ = z.union([
  storageObjectZ,
  folderZ,
])

export type Atom = z.infer<typeof atomZ>