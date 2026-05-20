import * as S from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import { KeySchema } from './key.js';

const decode = S.decodeUnknownSync(KeySchema);
const is = S.is(KeySchema);

describe('KeySchema', () => {
  describe('valid keys', () => {
    it('accepts simple alphanumeric key', () => {
      expect(() => decode('hello')).not.toThrow();
      expect(decode('hello')).toBe('hello');
    });

    it('accepts key with numbers', () => {
      expect(() => decode('file123')).not.toThrow();
    });

    it('accepts key with underscores', () => {
      expect(() => decode('my_file')).not.toThrow();
    });

    it('accepts key with hyphens', () => {
      expect(() => decode('my-file')).not.toThrow();
    });

    it('accepts key with forward slashes (path)', () => {
      expect(() => decode('folder/subfolder/file')).not.toThrow();
    });

    it('accepts key with mixed characters', () => {
      expect(() => decode('folder_1/sub-folder/my_file-2')).not.toThrow();
    });

    it('accepts single character', () => {
      expect(() => decode('a')).not.toThrow();
    });

    it('accepts uppercase letters', () => {
      expect(() => decode('MyFolder/MyFile')).not.toThrow();
    });

    it('is returns true for valid key', () => {
      expect(is('valid/key_name-123')).toBe(true);
    });
  });

  describe('invalid keys', () => {
    it('rejects empty string', () => {
      expect(() => decode('')).toThrow();
    });

    it('rejects path traversal with ../', () => {
      expect(() => decode('../etc/passwd')).toThrow();
    });

    it('rejects path traversal with ..', () => {
      expect(() => decode('..')).toThrow();
    });

    it('rejects key with dot', () => {
      expect(() => decode('file.txt')).toThrow();
    });

    it('rejects key with space', () => {
      expect(() => decode('my file')).toThrow();
    });

    it('rejects key with at-sign', () => {
      expect(() => decode('user@host')).toThrow();
    });

    it('rejects key with hash', () => {
      expect(() => decode('key#fragment')).toThrow();
    });

    it('rejects key with question mark', () => {
      expect(() => decode('key?query=1')).toThrow();
    });

    it('rejects key with backslash', () => {
      expect(() => decode('folder\\file')).toThrow();
    });

    it('rejects key with null byte', () => {
      expect(() => decode('key\0')).toThrow();
    });

    it('rejects non-string input', () => {
      expect(() => decode(42)).toThrow();
      expect(() => decode(null)).toThrow();
      expect(() => decode(undefined)).toThrow();
    });

    it('is returns false for invalid key', () => {
      expect(is('../traversal')).toBe(false);
      expect(is('')).toBe(false);
      expect(is('has space')).toBe(false);
    });
  });
});
