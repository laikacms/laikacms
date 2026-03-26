import * as S from 'effect/Schema';
import {
  JsonApiErrorSchema,
  AtomicOperationSchema,
  AtomicOperationsRequestSchema,
  AtomicOperationsResponseSchema,
  JsonApiLinksSchema,
  CursorPaginationMetaSchema,
  JsonApiCollectionResponseSchema,
  JsonApiResponseSchema,
  JsonApiResourceSchema,
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
