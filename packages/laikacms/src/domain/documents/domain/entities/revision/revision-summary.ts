import { AtomBaseSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { DocumentLanguage } from '../record/record-language';

export const RevisionSummarySchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('revision-summary'),
  language: DocumentLanguage,
  revision: S.String,
}));

export type RevisionSummary = S.Schema.Type<typeof RevisionSummarySchema>;
