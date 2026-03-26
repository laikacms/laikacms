import * as S from 'effect/Schema';
import { JsonApiLinksSchema } from './schemas.js';

// Filters for number validation
const isAtLeast1 = S.makeFilter<number>((n) => n >= 1 ? undefined : 'Must be at least 1');
const isAtLeast0 = S.makeFilter<number>((n) => n >= 0 ? undefined : 'Must be at least 0');

// Pagination types
export const PaginationPageBasedSchema = S.Struct({
  page: S.Number.pipe(S.check(isAtLeast1)),
  perPage: S.optional(S.Number.pipe(S.check(isAtLeast1))),
});

export const PaginationBeforeSchema = S.Struct({
  before: S.optional(S.String),
  perPage: S.optional(S.Number.pipe(S.check(isAtLeast1))),
});

export const PaginationAfterSchema = S.Struct({
  after: S.optional(S.String),
  perPage: S.optional(S.Number.pipe(S.check(isAtLeast1))),
});

export const PaginationOffsetSchema = S.Struct({
  offset: S.Number.pipe(S.check(isAtLeast0)),
  limit: S.optional(S.Number.pipe(S.check(isAtLeast1))),
});

export const PaginationSchema = S.Union([
  PaginationPageBasedSchema,
  PaginationBeforeSchema,
  PaginationAfterSchema,
  PaginationOffsetSchema,
]);

export type Pagination = S.Schema.Type<typeof PaginationSchema>;
export type JsonApiLinks = S.Schema.Type<typeof JsonApiLinksSchema>;

// Mutable version for building links
interface MutableJsonApiLinks {
  self?: string;
  first?: string;
  last?: string;
  prev?: string;
  next?: string;
}

// Type guards for pagination types
function isPageBased(p: Pagination): p is { page: number; perPage?: number } {
  return 'page' in p && typeof p.page === 'number';
}

function isOffsetBased(p: Pagination): p is { offset: number; limit?: number } {
  return 'offset' in p && typeof p.offset === 'number';
}

function isAfterBased(p: Pagination): p is { after?: string; perPage?: number } {
  return 'after' in p;
}

function isBeforeBased(p: Pagination): p is { before?: string; perPage?: number } {
  return 'before' in p && !('after' in p);
}

/**
 * Builds pagination links for JSON:API responses
 * @param baseUrl - Base URL for the resource
 * @param pagination - Pagination object
 * @param hasMore - Whether more results exist
 * @param currentCursor - Current cursor position (optional)
 */
export function buildPaginationLinks(
  baseUrl: string,
  pagination: Pagination,
  hasMore: boolean,
  currentCursor?: string,
  firstCursor?: string,
  lastCursor?: string
): JsonApiLinks {
  const links: MutableJsonApiLinks = {
    self: baseUrl,
  };

  if (isAfterBased(pagination)) {
    // Cursor-based pagination (forward)
    const perPage = pagination.perPage;
    
    // Add prev link if we have an after cursor (meaning we're not on the first page)
    if (pagination.after && firstCursor) {
      links.prev = `${baseUrl}?page[before]=${encodeURIComponent(firstCursor)}`;
      if (perPage) {
        links.prev += `&page[size]=${perPage}`;
      }
    }
    
    // Add next link if there are more results
    if (hasMore && lastCursor) {
      links.next = `${baseUrl}?page[after]=${encodeURIComponent(lastCursor)}`;
      if (perPage) {
        links.next += `&page[size]=${perPage}`;
      }
    }
  } else if (isBeforeBased(pagination)) {
    // Cursor-based pagination (backward)
    const perPage = pagination.perPage;
    
    // Add prev link if there are more results going backward
    if (hasMore && firstCursor) {
      links.prev = `${baseUrl}?page[before]=${encodeURIComponent(firstCursor)}`;
      if (perPage) {
        links.prev += `&page[size]=${perPage}`;
      }
    }
    
    // Add next link if we have a before cursor (meaning we're not on the last page)
    if (pagination.before && lastCursor) {
      links.next = `${baseUrl}?page[after]=${encodeURIComponent(lastCursor)}`;
      if (perPage) {
        links.next += `&page[size]=${perPage}`;
      }
    }
  } else if (isPageBased(pagination)) {
    // Page-based pagination
    const page = pagination.page;
    const perPage = pagination.perPage || 10;
    
    links.first = `${baseUrl}?page[number]=1&page[size]=${perPage}`;
    
    if (page > 1) {
      links.prev = `${baseUrl}?page[number]=${page - 1}&page[size]=${perPage}`;
    }
    
    if (hasMore) {
      links.next = `${baseUrl}?page[number]=${page + 1}&page[size]=${perPage}`;
    }
  } else if (isOffsetBased(pagination)) {
    // Offset-based pagination
    const offset = pagination.offset;
    const limit = pagination.limit || 10;
    
    links.first = `${baseUrl}?page[offset]=0&page[limit]=${limit}`;
    
    if (offset > 0) {
      const prevOffset = Math.max(0, offset - limit);
      links.prev = `${baseUrl}?page[offset]=${prevOffset}&page[limit]=${limit}`;
    }
    
    if (hasMore) {
      links.next = `${baseUrl}?page[offset]=${offset + limit}&page[limit]=${limit}`;
    }
  }

  return links;
}

// Type for parsed pagination that allows undefined perPage
type ParsedPagination = 
  | { after: string | undefined; perPage: number | undefined }
  | { before: string | undefined; perPage: number | undefined }
  | { page: number; perPage: number | undefined }
  | { offset: number; limit: number | undefined };

/**
 * Parses pagination parameters from query string
 * @param query - Record of query parameters
 * @returns Pagination object (cursor, page-based, or offset-based)
 */
export function parsePaginationQuery(query: Record<string, string | string[] | undefined>): ParsedPagination {
  const pageAfter = query['page[after]'];
  const pageBefore = query['page[before]'];
  const pageNumber = query['page[number]'];
  const pageSize = query['page[size]'];
  const pageOffset = query['page[offset]'];
  const pageLimit = query['page[limit]'];

  if (pageAfter) {
    return {
      after: Array.isArray(pageAfter) ? pageAfter[0] : pageAfter,
      perPage: pageSize ? parseInt(Array.isArray(pageSize) ? pageSize[0] : pageSize) : undefined,
    };
  }

  if (pageBefore) {
    return {
      before: Array.isArray(pageBefore) ? pageBefore[0] : pageBefore,
      perPage: pageSize ? parseInt(Array.isArray(pageSize) ? pageSize[0] : pageSize) : undefined,
    };
  }

  if (pageNumber) {
    return {
      page: parseInt(Array.isArray(pageNumber) ? pageNumber[0] : pageNumber),
      perPage: pageSize ? parseInt(Array.isArray(pageSize) ? pageSize[0] : pageSize) : undefined,
    };
  }

  if (pageOffset !== undefined) {
    return {
      offset: parseInt(Array.isArray(pageOffset) ? pageOffset[0] : pageOffset),
      limit: pageLimit ? parseInt(Array.isArray(pageLimit) ? pageLimit[0] : pageLimit) : undefined,
    };
  }

  // Default to cursor-based pagination
  return {
    after: undefined,
    perPage: 10,
  };
}
