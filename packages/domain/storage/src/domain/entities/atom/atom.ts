import * as S from 'effect/Schema';
import { FolderSchema } from '../folder/folder.js';
import { StorageObjectSchema } from '../object/storage-object.js';

export const AtomSchema = S.toStandardSchemaV1(S.Union([
  StorageObjectSchema,
  FolderSchema,
]));

export type Atom = S.Schema.Type<typeof AtomSchema>;
