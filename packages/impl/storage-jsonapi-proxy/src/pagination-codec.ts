import type { Pagination } from '@laikacms/storage';

/**
 * Pagination codec for encoding/decoding pagination parameters
 * to/from URL query parameters following JSON:API conventions
 */
export const paginationCodec = {
  /**
   * Encode pagination object to URLSearchParams
   */
  encode(pagination: Pagination): URLSearchParams {
    const params = new URLSearchParams();
    
    // Handle cursor-based pagination (after/before)
    if ('after' in pagination && pagination.after) {
      params.set('page[after]', pagination.after);
    }
    if ('before' in pagination && pagination.before) {
      params.set('page[before]', pagination.before);
    }
    
    // Handle page-based pagination
    if ('page' in pagination) {
      params.set('page[number]', String(pagination.page));
    }
    
    // Handle offset-based pagination
    if ('offset' in pagination) {
      params.set('page[offset]', String(pagination.offset));
    }
    if ('limit' in pagination && pagination.limit !== undefined) {
      params.set('page[limit]', String(pagination.limit));
    }
    
    // Handle perPage (common to cursor and page-based)
    if ('perPage' in pagination && pagination.perPage !== undefined) {
      params.set('page[size]', String(pagination.perPage));
    }
    
    return params;
  },

  /**
   * Decode URLSearchParams to pagination object
   * Defaults to cursor-based pagination with 'after'
   */
  decode(params: URLSearchParams): Pagination {
    // Check for cursor-based pagination
    const after = params.get('page[after]');
    const before = params.get('page[before]');
    const perPageStr = params.get('page[size]');
    const perPage = perPageStr ? parseInt(perPageStr, 10) : undefined;
    
    if (after) {
      return { after, perPage };
    }
    
    if (before) {
      return { before, perPage };
    }
    
    // Check for page-based pagination
    const pageStr = params.get('page[number]');
    if (pageStr) {
      const page = parseInt(pageStr, 10);
      return perPage ? { page, perPage } : { page };
    }
    
    // Check for offset-based pagination
    const offsetStr = params.get('page[offset]');
    const limitStr = params.get('page[limit]');
    if (offsetStr) {
      const offset = parseInt(offsetStr, 10);
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      return limit ? { offset, limit } : { offset };
    }
    
    // Default to cursor-based with after
    return perPage ? { after: undefined, perPage } : { after: undefined };
  },

  /**
   * Encode pagination to query string
   */
  encodeToString(pagination: Pagination): string {
    return this.encode(pagination).toString();
  },

  /**
   * Decode query string to pagination object
   */
  decodeFromString(queryString: string): Pagination {
    return this.decode(new URLSearchParams(queryString));
  }
};
