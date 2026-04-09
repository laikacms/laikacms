import { StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';

export const DocumentUpdateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.optional(S.Literal('published')),
  status: S.optional(S.Literal('published')),
  content: S.optional(StorageObjectContentSchema),
}));

export type DocumentUpdate = S.Schema.Type<typeof DocumentUpdateSchema>;
