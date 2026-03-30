import { AtomBaseSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';

/**
 * Summary schema for unpublished documents (used in list operations)
 */
export const UnpublishedSummarySchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('unpublished-summary'),
  status: S.String,
}));

export type UnpublishedSummary = S.Schema.Type<typeof UnpublishedSummarySchema>;
