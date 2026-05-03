import { describe, expect, it } from 'vitest';
import { basename, extension, pathCombine, pathToSegments } from './utils.js';

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
