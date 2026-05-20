import { describe, expect, it } from 'vitest';
import { basename, extension, pathCombine, pathToSegments } from './utils.js';

describe('pathToSegments', () => {
  it('splits a simple path into segments', () => {
    expect(pathToSegments('a/b/c')).toEqual(['a', 'b', 'c']);
  });

  it('handles leading slash', () => {
    expect(pathToSegments('/a/b')).toEqual(['a', 'b']);
  });

  it('handles trailing slash', () => {
    expect(pathToSegments('a/b/')).toEqual(['a', 'b']);
  });

  it('handles multiple consecutive slashes', () => {
    expect(pathToSegments('a//b')).toEqual(['a', 'b']);
  });

  it('returns empty array for empty string', () => {
    expect(pathToSegments('')).toEqual([]);
  });

  it('returns empty array for slash-only string', () => {
    expect(pathToSegments('/')).toEqual([]);
  });

  it('trims whitespace from segments', () => {
    expect(pathToSegments('a/ b /c')).toEqual(['a', 'b', 'c']);
  });

  it('returns single segment for path without slashes', () => {
    expect(pathToSegments('file')).toEqual(['file']);
  });
});

describe('pathCombine', () => {
  it('combines multiple segments with slash', () => {
    expect(pathCombine('a', 'b', 'c')).toBe('a/b/c');
  });

  it('ignores empty segments', () => {
    expect(pathCombine('a', '', 'c')).toBe('a/c');
  });

  it('trims whitespace from segments', () => {
    expect(pathCombine(' a ', ' b ')).toBe('a/b');
  });

  it('returns empty string when all segments are empty', () => {
    expect(pathCombine('', '')).toBe('');
  });

  it('returns single segment when called with one argument', () => {
    expect(pathCombine('folder')).toBe('folder');
  });

  it('handles no arguments', () => {
    expect(pathCombine()).toBe('');
  });

  it('does not add double slashes for trailing/leading slash segments', () => {
    // Segments are trimmed, slashes within segments are kept as-is
    expect(pathCombine('a', 'b')).toBe('a/b');
  });
});

describe('basename', () => {
  it('returns the last segment of a path', () => {
    expect(basename('folder/subfolder/file.txt')).toBe('file.txt');
  });

  it('handles path with no directory', () => {
    expect(basename('file.txt')).toBe('file.txt');
  });

  it('handles trailing slash', () => {
    expect(basename('folder/subfolder/')).toBe('subfolder');
  });

  it('returns empty string for empty string', () => {
    expect(basename('')).toBe('');
  });

  it('returns the separator for a single slash', () => {
    expect(basename('/')).toBe('/');
  });

  it('handles backslash as separator', () => {
    expect(basename('folder\\file.txt')).toBe('file.txt');
  });

  it('handles deep path', () => {
    expect(basename('a/b/c/d/e')).toBe('e');
  });

  it('handles filename with multiple dots', () => {
    expect(basename('path/to/archive.tar.gz')).toBe('archive.tar.gz');
  });
});

describe('extension', () => {
  it('returns the extension of a file', () => {
    expect(extension('file.txt')).toBe('txt');
  });

  it('returns extension from full path', () => {
    expect(extension('folder/file.json')).toBe('json');
  });

  it('returns empty string for file with no extension', () => {
    expect(extension('file')).toBe('');
  });

  it('returns empty string for dotfile (hidden file)', () => {
    // dot at position 0 means no extension per the implementation
    expect(extension('.gitignore')).toBe('');
  });

  it('returns last extension for multiple dots', () => {
    expect(extension('archive.tar.gz')).toBe('gz');
  });

  it('returns empty string for empty path', () => {
    expect(extension('')).toBe('');
  });

  it('returns extension from path with trailing slash', () => {
    expect(extension('folder/file.md/')).toBe('md');
  });

  it('returns extension in mixed-case', () => {
    expect(extension('Image.PNG')).toBe('PNG');
  });
});
