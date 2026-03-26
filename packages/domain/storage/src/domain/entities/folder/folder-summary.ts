import * as S from 'effect/Schema';

export const FolderSummarySchema = S.Struct({
  type: S.Literal('folder-summary'),
  key: S.String.pipe(S.check(S.isMaxLength(1023))),

  createdAt: S.optional(S.DateTimeUtcFromString),
  updatedAt: S.optional(S.DateTimeUtcFromString),
});

export type FolderSummary = S.Schema.Type<typeof FolderSummarySchema>;