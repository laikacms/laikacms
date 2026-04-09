import { StandardSchemaV1 } from '@standard-schema/spec';
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
}));

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

// Cursor Pagination Profile
// https://jsonapi.org/profiles/ethanresnick/cursor-pagination/
export const CursorPaginationMetaSchema = S.toStandardSchemaV1(S.Struct({
  page: S.optional(S.Struct({
    cursor: S.optional(S.String),
    hasMore: S.optional(S.Boolean),
  })),
}));

export const JsonApiResourceSchema = S.toStandardSchemaV1(S.Struct({
  type: S.String,
  id: S.String,
  attributes: S.Record(S.String, S.Any),
  relationships: S.optional(S.Record(S.String, S.Any)),
}));

export const JsonApiResponseSchema = S.toStandardSchemaV1(S.Struct({
  data: JsonApiResourceSchema,
  links: S.optional(JsonApiLinksSchema),
  meta: S.optional(S.Record(S.String, S.Any)),
}));

export const JsonApiCollectionResponseSchema = S.toStandardSchemaV1(S.Struct({
  data: S.Array(JsonApiResourceSchema),
  links: S.optional(JsonApiLinksSchema),
  meta: S.optional(CursorPaginationMetaSchema),
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
