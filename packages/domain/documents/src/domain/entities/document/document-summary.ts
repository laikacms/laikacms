import { AtomBaseSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';

export const DocumentSummarySchema = S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('published-summary'),
  status: S.Literal('published'),
});

export const DocumentSummarySchemaStandardV1 = S.toStandardSchemaV1(DocumentSummarySchema);

export type DocumentSummary = S.Schema.Type<typeof DocumentSummarySchema>;
