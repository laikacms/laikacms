import * as S from 'effect/Schema';

export const StorageObjectSummarySchema = S.Struct({
  type: S.Literal('object-summary'),

  key: S.String.pipe(S.check(S.isMaxLength(1023))),

  createdAt: S.optional(S.String),
  updatedAt: S.optional(S.String),
});

export const StorageObjectSummarySchemaStandardV1 = S.toStandardSchemaV1(StorageObjectSummarySchema);

export type StorageObjectSummary = S.Schema.Type<typeof StorageObjectSummarySchema>;
