import { StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { DocumentLanguage } from '../record/record-language';

export const RevisionCreateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('revision'),
  content: StorageObjectContentSchema,
  language: DocumentLanguage,
  revision: S.String,
}));

export type RevisionCreate = S.Schema.Type<typeof RevisionCreateSchema>;
