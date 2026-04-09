import '@standard-schema/spec';
import * as S from 'effect/Schema';

export const PaginationPageBasedSchema = S.toStandardSchemaV1(S.Struct({
  page: S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(1))),
  perPage: S.optional(S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(1)))),
}));

export const PaginationBeforeSchema = S.toStandardSchemaV1(S.Struct({
  before: S.optional(S.String),
  perPage: S.optional(S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(1)))),
}));

export const PaginationAfterSchema = S.toStandardSchemaV1(S.Struct({
  after: S.optional(S.String),
  perPage: S.optional(S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(1)))),
}));

export const PaginationOffsetSchema = S.toStandardSchemaV1(S.Struct({
  offset: S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(0))),
  limit: S.optional(S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(1)))),
}));

export const PaginationSchema = S.Union([
  PaginationPageBasedSchema,
  PaginationBeforeSchema,
  PaginationAfterSchema,
  PaginationOffsetSchema,
]);

export type Pagination = S.Schema.Type<typeof PaginationSchema>;
