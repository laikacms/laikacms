import { z } from 'zod';
import {
  jsonApiErrorZ,
  atomicOperationZ,
  atomicOperationsRequestZ,
  atomicOperationsResponseZ,
  jsonApiLinksZ,
  cursorPaginationMetaZ,
  jsonApiCollectionResponseZ,
  jsonApiResponseZ,
  jsonApiResourceZ,
} from './schemas.js';

export type JsonApiError = z.infer<typeof jsonApiErrorZ>;
export type AtomicOperation = z.infer<typeof atomicOperationZ>;
export type AtomicOperationsRequest = z.infer<typeof atomicOperationsRequestZ>;
export type AtomicOperationsResponse = z.infer<typeof atomicOperationsResponseZ>;
export type JsonApiLinks = z.infer<typeof jsonApiLinksZ>;
export type CursorPaginationMeta = z.infer<typeof cursorPaginationMetaZ>;
export type JsonApiCollectionResponse = z.infer<typeof jsonApiCollectionResponseZ>;
export type JsonApiResponse = z.infer<typeof jsonApiResponseZ>;
export type JsonApiResource = z.infer<typeof jsonApiResourceZ>;


