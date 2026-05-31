import * as S from 'effect/Schema';
import { AtomBaseSchema } from 'laikacms/storage';
import { DocumentLanguage } from '../record/record-language.js';

export const DocumentSummarySchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('published-summary'),
  language: DocumentLanguage,
  status: S.Literal('published'),
}));

export type DocumentSummary = S.Schema.Type<typeof DocumentSummarySchema>;
