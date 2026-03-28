import { AtomBaseSchema } from "@laikacms/storage";
import * as S from 'effect/Schema';

export const RevisionSummarySchema = S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('revision-summary'),
  revision: S.String,
});

export const RevisionSummarySchemaStandardV1 = S.toStandardSchemaV1(RevisionSummarySchema);

export type RevisionSummary = S.Schema.Type<typeof RevisionSummarySchema>;
