import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as S from 'effect/Schema';

export const AtomBaseSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.check(S.isMaxLength(1023)),

  createdAt: S.optional(S.String), // Replace with appropriate schema for isoDateWithFallbackZ
  updatedAt: S.optional(S.String), // Replace with appropriate schema for isoDateWithFallbackZ
}));

export type AtomBase = S.Schema.Type<typeof AtomBaseSchema>;
