import { describe, expect, it } from 'vitest';
import { buildPaginationLinks, parsePaginationQuery } from './pagination.js';

describe('parsePaginationQuery', () => {
  it('parses page[after] cursor pagination', () => {
    expect(parsePaginationQuery({ 'page[after]': 'cur1', 'page[size]': '20' })).toEqual({
      after: 'cur1',
      perPage: 20,
    });
  });

  it('parses page[before] cursor pagination', () => {
    expect(parsePaginationQuery({ 'page[before]': 'cur2' })).toEqual({
      before: 'cur2',
      perPage: undefined,
    });
  });

  it('parses page[number] / page[size] page-based pagination', () => {
    expect(parsePaginationQuery({ 'page[number]': '3', 'page[size]': '15' })).toEqual({
      page: 3,
      perPage: 15,
    });
  });

  it('parses page[offset] / page[limit] offset-based pagination', () => {
    expect(parsePaginationQuery({ 'page[offset]': '40', 'page[limit]': '20' })).toEqual({
      offset: 40,
      limit: 20,
    });
  });

  it('treats page[offset]=0 as a real value (not falsy)', () => {
    expect(parsePaginationQuery({ 'page[offset]': '0' })).toEqual({
      offset: 0,
      limit: undefined,
    });
  });

  it('falls back to cursor-based with perPage=10 when no params are provided', () => {
    expect(parsePaginationQuery({})).toEqual({ after: undefined, perPage: 10 });
  });

  it('takes the first value when a query parameter is repeated', () => {
    expect(parsePaginationQuery({ 'page[after]': ['a', 'b'] })).toEqual({
      after: 'a',
      perPage: undefined,
    });
  });

  it('prefers `after` over `before` when both are provided', () => {
    const result = parsePaginationQuery({ 'page[after]': 'A', 'page[before]': 'B' });
    expect(result).toEqual({ after: 'A', perPage: undefined });
  });
});

describe('buildPaginationLinks', () => {
  const base = 'https://api.example.com/things';

  describe('page-based', () => {
    it('includes self, first, prev, and next when on a middle page with more results', () => {
      const links = buildPaginationLinks(base, { page: 3, perPage: 20 }, true);
      expect(links.self).toBe(base);
      expect(links.first).toBe(`${base}?page[number]=1&page[size]=20`);
      expect(links.prev).toBe(`${base}?page[number]=2&page[size]=20`);
      expect(links.next).toBe(`${base}?page[number]=4&page[size]=20`);
    });

    it('omits prev on the first page', () => {
      const links = buildPaginationLinks(base, { page: 1, perPage: 10 }, true);
      expect(links.prev).toBeUndefined();
      expect(links.next).toBe(`${base}?page[number]=2&page[size]=10`);
    });

    it('omits next when hasMore is false', () => {
      const links = buildPaginationLinks(base, { page: 5, perPage: 10 }, false);
      expect(links.next).toBeUndefined();
    });

    it('defaults perPage to 10 when not provided', () => {
      const links = buildPaginationLinks(base, { page: 1 }, true);
      expect(links.next).toContain('page[size]=10');
    });
  });

  describe('offset-based', () => {
    it('includes first, prev, and next when not at offset 0 with more results', () => {
      const links = buildPaginationLinks(base, { offset: 40, limit: 20 }, true);
      expect(links.first).toBe(`${base}?page[offset]=0&page[limit]=20`);
      expect(links.prev).toBe(`${base}?page[offset]=20&page[limit]=20`);
      expect(links.next).toBe(`${base}?page[offset]=60&page[limit]=20`);
    });

    it('clamps prev offset to 0 when limit exceeds current offset', () => {
      const links = buildPaginationLinks(base, { offset: 5, limit: 20 }, true);
      expect(links.prev).toBe(`${base}?page[offset]=0&page[limit]=20`);
    });

    it('omits prev when at offset 0', () => {
      const links = buildPaginationLinks(base, { offset: 0, limit: 10 }, true);
      expect(links.prev).toBeUndefined();
    });
  });

  describe('cursor-based (after)', () => {
    it('emits next using the lastCursor when more results exist', () => {
      const links = buildPaginationLinks(base, { after: 'cur', perPage: 25 }, true, undefined, 'first', 'last');
      expect(links.next).toBe(`${base}?page[after]=last&page[size]=25`);
    });

    it('emits prev pointing to the firstCursor when after is set', () => {
      const links = buildPaginationLinks(base, { after: 'cur' }, false, undefined, 'first');
      expect(links.prev).toBe(`${base}?page[before]=first`);
    });

    it('omits next when there are no more results', () => {
      const links = buildPaginationLinks(base, { after: 'cur' }, false, undefined, undefined, 'last');
      expect(links.next).toBeUndefined();
    });

    it('URL-encodes cursor values', () => {
      const links = buildPaginationLinks(
        base,
        { after: 'cur', perPage: 10 },
        true,
        undefined,
        undefined,
        'cursor with spaces&special=chars',
      );
      expect(links.next).toContain('cursor%20with%20spaces%26special%3Dchars');
    });
  });

  describe('cursor-based (before)', () => {
    it('emits prev when more results exist going backward', () => {
      const links = buildPaginationLinks(base, { before: 'cur' }, true, undefined, 'first');
      expect(links.prev).toBe(`${base}?page[before]=first`);
    });

    it('emits next pointing to the lastCursor when before is set', () => {
      const links = buildPaginationLinks(base, { before: 'cur' }, false, undefined, undefined, 'last');
      expect(links.next).toBe(`${base}?page[after]=last`);
    });
  });
});
