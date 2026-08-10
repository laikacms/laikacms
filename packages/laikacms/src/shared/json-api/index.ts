// Export schemas
export * from './schemas.js';

// Export transformers
export * from './transformers.js';

// Export pagination utilities and types
export {
  buildPaginationLinks,
  type JsonApiLinks,
  MAX_PAGE_SIZE,
  type Pagination,
  PaginationAfterSchema,
  PaginationBeforeSchema,
  PaginationOffsetSchema,
  PaginationPageBasedSchema,
  PaginationSchema,
  parsePaginationQuery,
} from './pagination.js';

export { paginationCodec } from './pagination-codec.js';

// Export types
export * from './types.js';

export * from './utilities.js';

export * from './errors.js';

// Export the Effect HttpClient-based transport shared by the *-jsonapi-proxy
// repositories (connection reuse via an injectable, layer-built client)
export * from './http-transport.js';

// Export OpenAPI authoring types and the component vocabulary the api/*
// packages' openapi.ts specs are built from
export * from './openapi-components.js';
export * from './openapi.js';
