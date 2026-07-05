export const pathToSegments = (path: string) => {
  const segments = path
    .split('/')
    .map(x => x.trim())
    .filter(x => x.length > 0);
  return segments;
};

export const pathCombine = (...segments: string[]) => {
  const path = segments
    .map(x => x.trim())
    .filter(x => x.length > 0)
    .join('/');
  return path;
};

export const basename = (path: string) => {
  if (typeof path !== 'string') return '';

  if (path.length === 0) return '';

  // Remove trailing separators
  let end = path.length - 1;
  while (end > 0 && (path[end] === '/' || path[end] === '\\')) end--;

  // If path is all separators like "/" or "\\\\" -> return single separator
  if (end === 0 && (path[0] === '/' || path[0] === '\\')) return path[0];

  // Find last separator before the basename
  let start = end;
  while (start >= 0 && path[start] !== '/' && path[start] !== '\\') start--;

  return path.slice(start + 1, end + 1);
};

export const extension = (path: string) => {
  const base = basename(path);
  const lastDotIndex = base.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return '';
  }
  return base.slice(lastDotIndex + 1);
};

import type { Pagination } from 'laikacms/core';

/**
 * Numeric-aware string comparator. Sorts `["1", "2", "10"]` rather than the
 * lexicographic `["1", "10", "2"]`. Used by storage listings so consumers see a
 * stable, human-friendly order regardless of the underlying store's native order
 * (FS returns directory order, R2 returns lexicographic).
 */
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const naturalCompare = (a: string, b: string): number => naturalCollator.compare(a, b);

/**
 * In-memory pagination helper for storage impls that don't natively paginate (FS, R2
 * directory listings). Supports `offset`/`limit` and `page`/`perPage`; cursor forms
 * (`before`/`after`) fall back to returning the full list.
 */
export const applyPagination = <T>(items: readonly T[], pagination: Pagination | undefined): T[] => {
  if (!pagination) return [...items];
  if ('offset' in pagination) {
    const limit = pagination.limit ?? items.length;
    return items.slice(pagination.offset, pagination.offset + limit);
  }
  if ('page' in pagination) {
    const perPage = pagination.perPage ?? items.length;
    const offset = Math.max(0, (pagination.page - 1) * perPage);
    return items.slice(offset, offset + perPage);
  }
  // Cursor-based: in-memory backends can't resolve opaque cursor values, so
  // return a full copy when a real cursor is provided. When starting from the
  // beginning (no cursor) and a page size is requested, honour it — this is
  // what makes a standalone ?page[size]=N work for FS/R2/WebDAV listings.
  if ('after' in pagination && pagination.after === undefined && pagination.perPage !== undefined) {
    return items.slice(0, pagination.perPage);
  }
  if ('before' in pagination && pagination.before === undefined && pagination.perPage !== undefined) {
    return items.slice(0, pagination.perPage);
  }
  return [...items];
};
