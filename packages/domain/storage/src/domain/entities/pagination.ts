import * as S from 'effect/Schema';

export const PaginationPageBasedSchema = S.Struct({
  page: S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(1))),
  perPage: S.optional(S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(1)))),
});

export const PaginationBeforeSchema = S.Struct({
  before: S.optional(S.String),
  perPage: S.optional(S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(1)))),
});

export const PaginationAfterSchema = S.Struct({
  after: S.optional(S.String),
  perPage: S.optional(S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(1)))),
});

export const PaginationOffsetSchema = S.Struct({
  offset: S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(0))),
  limit: S.optional(S.Number.pipe(S.check(S.isGreaterThanOrEqualTo(1)))),
});

export const PaginationSchema = S.Union([
  PaginationPageBasedSchema,
  PaginationBeforeSchema,
  PaginationAfterSchema,
  PaginationOffsetSchema,
]);

export type Pagination = S.Schema.Type<typeof PaginationSchema>;
