import * as S from 'effect/Schema';
import type { StandardSchemaV1 } from '@standard-schema/spec'

export const AtomBaseSchema = S.Struct({
  key: S.String.check(S.isMaxLength(1023)),

  createdAt: S.optional(S.String), // Replace with appropriate schema for isoDateWithFallbackZ
  updatedAt: S.optional(S.String), // Replace with appropriate schema for isoDateWithFallbackZ
});

export const AtomBaseSchemaStandardV1 = S.toStandardSchemaV1(AtomBaseSchema);

export type AtomBase = S.Schema.Type<typeof AtomBaseSchema>