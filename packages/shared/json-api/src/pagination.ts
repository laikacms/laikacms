import { z } from 'zod';
import { jsonApiLinksZ } from './schemas.js';

// Pagination types (should be imported from storage package in real usage)
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
]);

export type Pagination = z.infer<typeof paginationZ>;
export type JsonApiLinks = z.infer<typeof jsonApiLinksZ>;

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
  const links: JsonApiLinks = {
    self: baseUrl,
  };

  if ('after' in pagination) {
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
  } else if ('before' in pagination) {
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
  } else if ('page' in pagination) {
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
  } else if ('offset' in pagination) {
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

/**
 * Parses pagination parameters from query string
 * @param query - Record of query parameters
 * @returns Pagination object (cursor, page-based, or offset-based)
 */
export function parsePaginationQuery(query: Record<string, string | string[] | undefined>): Pagination {
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