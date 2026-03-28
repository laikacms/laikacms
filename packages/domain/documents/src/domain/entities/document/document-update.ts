import * as S from 'effect/Schema';
import { StorageObjectContentSchema } from '@laikacms/storage';

export const DocumentUpdateSchema = S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.optional(S.Literal('published')),
  status: S.optional(S.Literal('published')),
  content: S.optional(StorageObjectContentSchema),
});

export const DocumentUpdateSchemaStandardV1 = S.toStandardSchemaV1(DocumentUpdateSchema);

export type DocumentUpdate = S.Schema.Type<typeof DocumentUpdateSchema>;
