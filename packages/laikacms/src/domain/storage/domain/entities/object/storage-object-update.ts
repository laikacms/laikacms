import * as S from 'effect/Schema';
import { StorageObjectContentSchema } from './storage-object.js';

export const StorageObjectUpdateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.optional(S.Literal('object')),
  content: S.optional(StorageObjectContentSchema),
}));

export type StorageObjectUpdate = S.Schema.Type<typeof StorageObjectUpdateSchema>;
