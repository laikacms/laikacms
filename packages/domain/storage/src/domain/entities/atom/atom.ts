import * as S from 'effect/Schema'
import { storageObjectZ } from "../object/storage-object.js"
import { folderZ } from "../folder/folder.js"

export const AtomSchema = S.Union([
  storageObjectZ,
  folderZ,
])

export type Atom = S.Schema.Type<typeof AtomSchema>