import * as S from 'effect/Schema';

export const FolderSummarySchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('folder-summary'),
  key: S.String.pipe(S.check(S.isMaxLength(1023))),

  createdAt: S.optional(S.String),
  updatedAt: S.optional(S.String),
}));

export type FolderSummary = S.Schema.Type<typeof FolderSummarySchema>;
