import * as S from 'effect/Schema';

export const StorageObjectSummarySchema = S.Struct({
  type: S.Literal('object-summary'),

  key: S.String.pipe(S.check(S.isMaxLength(1023))),

  createdAt: S.optional(S.DateTimeUtcFromString),
  updatedAt: S.optional(S.DateTimeUtcFromString),
});

export type StorageObjectSummary = S.Schema.Type<typeof StorageObjectSummarySchema>;
