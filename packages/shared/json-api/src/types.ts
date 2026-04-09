import type * as S from 'effect/Schema';
import type {
  AtomicOperationSchema,
  AtomicOperationsRequestSchema,
  AtomicOperationsResponseSchema,
  CursorPaginationMetaSchema,
  JsonApiCollectionResponseSchema,
  JsonApiErrorSchema,
  JsonApiLinksSchema,
  JsonApiResourceSchema,
  JsonApiResponseSchema,
} from './schemas.js';

export type JsonApiError = S.Schema.Type<typeof JsonApiErrorSchema>;
export type AtomicOperation = S.Schema.Type<typeof AtomicOperationSchema>;
export type AtomicOperationsRequest = S.Schema.Type<typeof AtomicOperationsRequestSchema>;
export type AtomicOperationsResponse = S.Schema.Type<typeof AtomicOperationsResponseSchema>;
export type JsonApiLinks = S.Schema.Type<typeof JsonApiLinksSchema>;
export type CursorPaginationMeta = S.Schema.Type<typeof CursorPaginationMetaSchema>;
export type JsonApiCollectionResponse = S.Schema.Type<typeof JsonApiCollectionResponseSchema>;
export type JsonApiResponse = S.Schema.Type<typeof JsonApiResponseSchema>;
export type JsonApiResource = S.Schema.Type<typeof JsonApiResourceSchema>;
