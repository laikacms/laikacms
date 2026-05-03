import { AtomBaseSchema, StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { DocumentLanguage } from '../record/record-language';

export const DocumentSchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('published'),
  status: S.Literal('published'),
  language: DocumentLanguage,
  content: StorageObjectContentSchema,
}));

export type Document = S.Schema.Type<typeof DocumentSchema>;
