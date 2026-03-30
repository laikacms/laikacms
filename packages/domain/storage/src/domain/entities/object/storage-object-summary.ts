import * as S from 'effect/Schema';

export const StorageObjectSummarySchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object-summary'),

  key: S.String.pipe(S.check(S.isMaxLength(1023))),

  createdAt: S.optional(S.String),
  updatedAt: S.optional(S.String),
}));

export type StorageObjectSummary = S.Schema.Type<typeof StorageObjectSummarySchema>;
