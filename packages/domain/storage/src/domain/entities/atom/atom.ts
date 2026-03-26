import * as S from 'effect/Schema';
import { StorageObjectSchema } from "../object/storage-object.js";
import { FolderSchema } from "../folder/folder.js";

export const AtomSchema = S.Union([
  StorageObjectSchema,
  FolderSchema,
]);

export type Atom = S.Schema.Type<typeof AtomSchema>;