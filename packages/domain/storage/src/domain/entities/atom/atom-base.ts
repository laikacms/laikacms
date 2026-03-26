import * as S from 'effect/Schema';

export const AtomBaseSchema = S.Struct({
  key: S.String.check(S.isMaxLength(1023)),

  createdAt: S.optional(S.String), // Replace with appropriate schema for isoDateWithFallbackZ
  updatedAt: S.optional(S.String), // Replace with appropriate schema for isoDateWithFallbackZ
})

export type AtomBase = S.Schema.Type<typeof AtomBaseSchema>