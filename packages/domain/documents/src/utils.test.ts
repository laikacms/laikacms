import { describe, expect, it } from 'vitest';
import { pathCombine, pathToSegments } from './utils.js';

describe('pathToSegments', () => {
  it('splits a normal path into its segments', () => {
    expect(pathToSegments('a/b/c')).toEqual(['a', 'b', 'c']);
  });

  it('strips empty segments from leading, trailing, and double slashes', () => {
    expect(pathToSegments('/a//b/')).toEqual(['a', 'b']);
  });

  it('trims whitespace inside each segment', () => {
    expect(pathToSegments(' a / b / c ')).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for an empty string', () => {
    expect(pathToSegments('')).toEqual([]);
  });

  it('returns an empty array for a path of only slashes', () => {
    expect(pathToSegments('///')).toEqual([]);
  });
});

describe('pathCombine', () => {
  it('joins segments with a single slash', () => {
    expect(pathCombine('a', 'b', 'c')).toBe('a/b/c');
  });

  it('drops empty segments', () => {
    expect(pathCombine('a', '', 'b')).toBe('a/b');
  });

  it('trims whitespace from each segment', () => {
    expect(pathCombine(' a ', ' b ')).toBe('a/b');
  });

  it('returns an empty string when given no segments', () => {
    expect(pathCombine()).toBe('');
  });

  it('returns an empty string when all segments are blank', () => {
    expect(pathCombine('', '   ', '')).toBe('');
  });
});
