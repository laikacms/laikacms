import { AtomBaseSchema } from "@laikacms/storage";
import * as S from 'effect/Schema';

export const RevisionSummarySchema = S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('revision-summary'),
  revision: S.String,
});

export type RevisionSummary = S.Schema.Type<typeof RevisionSummarySchema>;
