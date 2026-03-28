import * as S from 'effect/Schema';
import { StorageObjectSchema } from "../object/storage-object.js";
import { FolderSchema } from "../folder/folder.js";

export const AtomSchema = S.Union([
  StorageObjectSchema,
  FolderSchema,
]);

export const AtomSchemaStandardV1 = S.toStandardSchemaV1(AtomSchema);

export type Atom = S.Schema.Type<typeof AtomSchema>;