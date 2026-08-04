import { describe, expect, it } from 'vitest';
import { isSafeIdentifier, RESERVED_WORDS } from './identifier.js';

describe('isSafeIdentifier', () => {
  it('accepts plain identifiers and $/_ starts', () => {
    expect(isSafeIdentifier('title')).toBe(true);
    expect(isSafeIdentifier('_private')).toBe(true);
    expect(isSafeIdentifier('$key')).toBe(true);
    expect(isSafeIdentifier('camelCase123')).toBe(true);
  });

  it('rejects non-identifier shapes', () => {
    expect(isSafeIdentifier('')).toBe(false);
    expect(isSafeIdentifier('with-dash')).toBe(false);
    expect(isSafeIdentifier('has space')).toBe(false);
    expect(isSafeIdentifier('1leading')).toBe(false);
    expect(isSafeIdentifier('a.b')).toBe(false);
  });

  it('rejects reserved words', () => {
    expect(isSafeIdentifier('default')).toBe(false);
    expect(isSafeIdentifier('class')).toBe(false);
    expect(isSafeIdentifier('await')).toBe(false);
    for (const word of RESERVED_WORDS) {
      expect(isSafeIdentifier(word)).toBe(false);
    }
  });
});
