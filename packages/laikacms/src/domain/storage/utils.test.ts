import { describe, expect, it } from 'vitest';
import { applyPagination, basename, extension, naturalCompare, pathCombine, pathToSegments } from './utils.js';

describe('pathToSegments', () => {
  it('splits a path into its non-empty segments', () => {
    expect(pathToSegments('a/b/c')).toEqual(['a', 'b', 'c']);
  });

  it('drops leading, trailing, and consecutive empty segments', () => {
    expect(pathToSegments('/a//b/')).toEqual(['a', 'b']);
  });

  it('trims whitespace inside each segment', () => {
    expect(pathToSegments(' a / b ')).toEqual(['a', 'b']);
  });

  it('returns an empty array for empty input', () => {
    expect(pathToSegments('')).toEqual([]);
    expect(pathToSegments('///')).toEqual([]);
  });
});

describe('pathCombine', () => {
  it('joins segments with a single slash', () => {
    expect(pathCombine('a', 'b', 'c')).toBe('a/b/c');
  });

  it('skips empty / whitespace-only segments', () => {
    expect(pathCombine('a', '', '   ', 'b')).toBe('a/b');
  });

  it('returns an empty string when no useful segments are provided', () => {
    expect(pathCombine()).toBe('');
    expect(pathCombine('', '   ')).toBe('');
  });
});

describe('basename', () => {
  it('returns the last forward-slash segment', () => {
    expect(basename('foo/bar/baz.txt')).toBe('baz.txt');
  });

  it('handles backslash separators', () => {
    expect(basename('foo\\bar\\baz.txt')).toBe('baz.txt');
  });

  it('strips a trailing slash before extracting the basename', () => {
    expect(basename('foo/bar/')).toBe('bar');
  });

  it('returns the path itself when there is no separator', () => {
    expect(basename('file.txt')).toBe('file.txt');
  });

  it('returns "/" for a root-only path', () => {
    expect(basename('/')).toBe('/');
  });

  it('returns "" for an empty string', () => {
    expect(basename('')).toBe('');
  });

  it('returns "" for a non-string input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(basename(null as any)).toBe('');
  });
});

describe('extension', () => {
  it('returns the part after the last dot', () => {
    expect(extension('foo/bar/baz.txt')).toBe('txt');
  });

  it('returns the last extension for multi-dot filenames', () => {
    expect(extension('archive.tar.gz')).toBe('gz');
  });

  it('returns "" when there is no dot', () => {
    expect(extension('foo/bar/baz')).toBe('');
  });

  it('returns "" for dotfiles (no extension)', () => {
    expect(extension('.gitignore')).toBe('');
  });

  it('returns "" for an empty path', () => {
    expect(extension('')).toBe('');
  });
});

describe('naturalCompare', () => {
  it('orders bare numeric strings numerically, not lexicographically', () => {
    expect(['10', '2', '1', '11'].sort(naturalCompare)).toEqual(['1', '2', '10', '11']);
  });

  it('orders mixed alpha/numeric strings naturally', () => {
    expect(['file10', 'file2', 'file1'].sort(naturalCompare)).toEqual(['file1', 'file2', 'file10']);
  });

  it('returns 0 for identical strings', () => {
    expect(naturalCompare('a', 'a')).toBe(0);
  });

  it('orders pure alpha strings alphabetically', () => {
    expect(['banana', 'apple', 'cherry'].sort(naturalCompare)).toEqual(['apple', 'banana', 'cherry']);
  });
});

describe('applyPagination', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('returns a shallow copy when pagination is undefined', () => {
    const out = applyPagination(items, undefined);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });

  it('applies offset + limit', () => {
    expect(applyPagination(items, { offset: 1, limit: 2 })).toEqual(['b', 'c']);
  });

  it('defaults limit to "rest of list" when omitted', () => {
    expect(applyPagination(items, { offset: 2 })).toEqual(['c', 'd', 'e']);
  });

  it('applies page + perPage (1-indexed pages)', () => {
    expect(applyPagination(items, { page: 1, perPage: 2 })).toEqual(['a', 'b']);
    expect(applyPagination(items, { page: 2, perPage: 2 })).toEqual(['c', 'd']);
    expect(applyPagination(items, { page: 3, perPage: 2 })).toEqual(['e']);
  });

  it('returns a copy for cursor pagination (before/after) since the helper cannot resolve cursors', () => {
    const out = applyPagination(items, { after: 'b', perPage: 2 });
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });

  it('clamps page=1 with no perPage to the whole list', () => {
    expect(applyPagination(items, { page: 1 })).toEqual(items);
  });
});
