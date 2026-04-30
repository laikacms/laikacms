import { StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { DocumentLanguage } from '../record/record-language';

export const RevisionUpdateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.optional(S.Literal('revision')),
  content: S.optional(StorageObjectContentSchema),
  language: S.optional(DocumentLanguage),
  revision: S.optional(S.String),
}));

export type RevisionUpdate = S.Schema.Type<typeof RevisionUpdateSchema>;
