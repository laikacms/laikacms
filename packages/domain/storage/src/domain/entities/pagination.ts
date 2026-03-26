import z from "zod";

export const paginationPageBasedZ = z.object({
  page: z.number().min(1).default(1),
  perPage: z.number().min(1).optional(),
});

export const paginationBeforeZ = z.object({
  before: z.string().optional(),
  perPage: z.number().min(1).optional(),
});

export const paginationAfterZ = z.object({
  after: z.string().optional(),
  perPage: z.number().min(1).optional(),
});

export const paginationOffsetZ = z.object({
  offset: z.number().min(0).default(0),
  limit: z.number().min(1).optional(),
});

export const paginationZ = z.union([
  paginationPageBasedZ,
  paginationBeforeZ,
  paginationAfterZ,
  paginationOffsetZ,
])

export type Pagination = z.infer<typeof paginationZ>;
