import { AtomBaseSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { DocumentLanguage } from '../record/record-language';

export const DocumentSummarySchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('published-summary'),
  language: DocumentLanguage,
  status: S.Literal('published'),
}));

export type DocumentSummary = S.Schema.Type<typeof DocumentSummarySchema>;
