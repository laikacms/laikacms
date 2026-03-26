import { z } from 'zod';

// JSON:API Error Schema
export const jsonApiErrorZ = z.object({
  errors: z.array(
    z.object({
      code: z.string(),
      status: z.string(),
      title: z.string(),
      detail: z.string(),
      source: z.object({
        pointer: z.string().optional(),
        parameter: z.string().optional(),
      }).optional(),
    })
  ),
});

// JSON:API Delete Operations
export const jsonApiDeleteZ = z.object({
  data: z.object({
    type: z.string(),
    id: z.string(),
  }),
});

export const jsonApiDeleteMultipleZ = z.object({
  data: z.array(
    z.object({
      type: z.string(),
      id: z.string(),
    })
  ),
});

// JSON:API Atomic Operations Extension
// https://jsonapi.org/ext/atomic/
export const atomicOperationZ = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    data: z.object({
      type: z.string(),
      id: z.string().optional(),
      attributes: z.record(z.string(), z.any()).optional(),
      relationships: z.record(z.string(), z.any()).optional(),
    }),
  }),
  z.object({
    op: z.literal('update'),
    data: z.object({
      type: z.string(),
      id: z.string(),
      attributes: z.record(z.string(), z.any()).optional(),
      relationships: z.record(z.string(), z.any()).optional(),
    }),
  }),
  z.object({
    op: z.literal('remove'),
    ref: z.object({
      type: z.string(),
      id: z.string(),
    }),
  }),
]);

export const atomicOperationsRequestZ = z.object({
  'atomic:operations': z.array(atomicOperationZ),
});

export const atomicOperationsResponseZ = z.object({
  'atomic:results': z.array(
    z.object({
      data: z.union([
        z.object({
          type: z.string(),
          id: z.string(),
          attributes: z.record(z.string(), z.any()).optional(),
        }),
        z.null(),
      ]),
    })
  ),
});

// JSON:API Pagination
export const jsonApiLinksZ = z.object({
  self: z.string().optional(),
  first: z.string().optional(),
  last: z.string().optional(),
  prev: z.string().optional(),
  next: z.string().optional(),
});

// Cursor Pagination Profile
// https://jsonapi.org/profiles/ethanresnick/cursor-pagination/
export const cursorPaginationMetaZ = z.object({
  page: z.object({
    cursor: z.string().optional(),
    hasMore: z.boolean().optional(),
  }).loose().optional(),
});

export const jsonApiResourceZ = z.object({
  type: z.string(),
  id: z.string(),
  attributes: z.record(z.string(), z.any()),
  relationships: z.record(z.string(), z.any()).optional(),
});

export const jsonApiResponseZ = z.object({
  data: jsonApiResourceZ,
  links: jsonApiLinksZ.optional(),
  meta: z.record(z.string(), z.any()).optional(),
});

export const jsonApiCollectionResponseZ = z.object({
  data: z.array(jsonApiResourceZ),
  links: jsonApiLinksZ.optional(),
  meta: cursorPaginationMetaZ.optional(),
  included: z.array(jsonApiResourceZ).optional(),
});