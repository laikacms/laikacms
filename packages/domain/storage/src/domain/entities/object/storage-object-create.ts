import * as S from 'effect/Schema';
import { StorageObjectContentSchema } from './storage-object.js';

export const StorageObjectCreateSchema = S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('object'),
  content: StorageObjectContentSchema,
});

export const StorageObjectCreateSchemaStandardV1 = S.toStandardSchemaV1(StorageObjectCreateSchema);

export type StorageObjectCreate = S.Schema.Type<typeof StorageObjectCreateSchema>;