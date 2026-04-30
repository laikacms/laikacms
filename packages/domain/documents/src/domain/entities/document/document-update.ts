import { StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { DocumentLanguage } from '../record/record-language';

export const DocumentUpdateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.optional(S.Literal('published')),
  status: S.optional(S.Literal('published')),
  language: S.optional(DocumentLanguage),
  content: S.optional(StorageObjectContentSchema),
}));

export type DocumentUpdate = S.Schema.Type<typeof DocumentUpdateSchema>;
