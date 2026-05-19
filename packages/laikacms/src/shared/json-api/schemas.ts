import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as S from 'effect/Schema';

// JSON:API Error Schema
export const JsonApiErrorSchema = S.toStandardSchemaV1(S.Struct({
  errors: S.Array(
    S.Struct({
      code: S.String,
      status: S.String,
      title: S.String,
      detail: S.String,
      source: S.optional(S.Struct({
        pointer: S.optional(S.String),
        parameter: S.optional(S.String),
      })),
    }),
  ),
})) satisfies StandardSchemaV1;

// JSON:API Delete Operations
export const JsonApiDeleteSchema = S.toStandardSchemaV1(S.Struct({
  data: S.Struct({
    type: S.String,
    id: S.String,
  }),
}));

export const JsonApiDeleteMultipleSchema = S.toStandardSchemaV1(S.Struct({
  data: S.Array(
    S.Struct({
      type: S.String,
      id: S.String,
    }),
  ),
}));

// JSON:API Atomic Operations Extension
// https://jsonapi.org/ext/atomic/
const AtomicAddOperationSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('add'),
  data: S.Struct({
    type: S.String,
    id: S.optional(S.String),
    attributes: S.optional(S.Record(S.String, S.Any)),
    relationships: S.optional(S.Record(S.String, S.Any)),
  }),
}));

const AtomicUpdateOperationSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('update'),
  data: S.Struct({
    type: S.String,
    id: S.String,
    attributes: S.optional(S.Record(S.String, S.Any)),
    relationships: S.optional(S.Record(S.String, S.Any)),
  }),
}));

const AtomicRemoveOperationSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('remove'),
  ref: S.Struct({
    type: S.String,
    id: S.String,
  }),
}));

export const AtomicOperationSchema = S.toStandardSchemaV1(S.Union([
  AtomicAddOperationSchema,
  AtomicUpdateOperationSchema,
  AtomicRemoveOperationSchema,
]));

export const AtomicOperationsRequestSchema = S.toStandardSchemaV1(S.Struct({
  'atomic:operations': S.Array(AtomicOperationSchema),
}));

export const AtomicOperationsResponseSchema = S.toStandardSchemaV1(S.Struct({
  'atomic:results': S.Array(
    S.Struct({
      data: S.Union([
        S.Struct({
          type: S.String,
          id: S.String,
          attributes: S.optional(S.Record(S.String, S.Any)),
        }),
        S.Null,
      ]),
    }),
  ),
}));

// JSON:API Pagination
export const JsonApiLinksSchema = S.toStandardSchemaV1(S.Struct({
  self: S.optional(S.String),
  first: S.optional(S.String),
  last: S.optional(S.String),
  prev: S.optional(S.String),
  next: S.optional(S.String),
}));

// Pagination meta — per JSON:API §8 and the cursor-pagination profile
// (https://jsonapi.org/profiles/ethanresnick/cursor-pagination/),
// *navigation* lives in the top-level `links` object, not in `meta`. The
// only pagination-shaped values that legitimately belong here are
// aggregate counts that can't be encoded as links:
//
//   meta.page = {
//     total?,          // exact total when the backend supplies one cheaply
//     estimatedTotal?, // rough total when an exact count is too expensive
//   }
//
// `hasMore` is implicit in the presence/absence of the `next` link;
// the "current cursor" is implicit in the request URL itself.
export const PaginationMetaSchema = S.toStandardSchemaV1(S.Struct({
  page: S.optional(S.Struct({
    total: S.optional(S.Number),
    estimatedTotal: S.optional(S.Number),
  })),
}));

export const JsonApiResourceSchema = S.toStandardSchemaV1(S.Struct({
  type: S.String,
  id: S.String,
  attributes: S.Record(S.String, S.Any),
  relationships: S.optional(S.Record(S.String, S.Any)),
  /**
   * Per JSON:API spec, resource-level `meta` is the right home for
   * protocol / backend-specific information that isn't part of the entity's
   * primary attributes — e.g. a storage object's `extension` + `revisionId`.
   */
  meta: S.optional(S.Record(S.String, S.Any)),
  /**
   * Resource-level links per JSON:API spec — at minimum `self`, optionally
   * `related`. Lets a client navigate from a collection item to its
   * canonical detail URL without reconstructing the route table.
   */
  links: S.optional(S.Record(S.String, S.String)),
}));

export const JsonApiResponseSchema = S.toStandardSchemaV1(S.Struct({
  data: JsonApiResourceSchema,
  links: S.optional(JsonApiLinksSchema),
  meta: S.optional(S.Record(S.String, S.Any)),
}));

export const JsonApiCollectionResponseSchema = S.toStandardSchemaV1(S.Struct({
  data: S.Array(JsonApiResourceSchema),
  links: S.optional(JsonApiLinksSchema),
  meta: S.optional(PaginationMetaSchema),
  included: S.optional(S.Array(JsonApiResourceSchema)),
}));

// Decoders for parsing unknown data
export const decodeJsonApiError = S.decodeUnknownSync(JsonApiErrorSchema);
export const decodeJsonApiDelete = S.decodeUnknownSync(JsonApiDeleteSchema);
export const decodeJsonApiDeleteMultiple = S.decodeUnknownSync(JsonApiDeleteMultipleSchema);
export const decodeAtomicOperation = S.decodeUnknownSync(AtomicOperationSchema);
export const decodeAtomicOperationsRequest = S.decodeUnknownSync(AtomicOperationsRequestSchema);
export const decodeAtomicOperationsResponse = S.decodeUnknownSync(AtomicOperationsResponseSchema);
export const decodeJsonApiResource = S.decodeUnknownSync(JsonApiResourceSchema);
export const decodeJsonApiResponse = S.decodeUnknownSync(JsonApiResponseSchema);
export const decodeJsonApiCollectionResponse = S.decodeUnknownSync(JsonApiCollectionResponseSchema);

// Safe decoder that returns Exit
export const decodeJsonApiErrorExit = S.decodeUnknownExit(JsonApiErrorSchema);
