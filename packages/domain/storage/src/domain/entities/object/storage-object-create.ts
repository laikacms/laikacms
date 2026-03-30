import * as S from 'effect/Schema';
import { StorageObjectContentSchema } from './storage-object.js';

export const StorageObjectCreateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('object'),
  content: StorageObjectContentSchema,
}));

export type StorageObjectCreate = S.Schema.Type<typeof StorageObjectCreateSchema>;