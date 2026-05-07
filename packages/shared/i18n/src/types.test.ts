import { describe, expect, it } from 'vitest';
import { isSupportedLocale } from './types.js';

describe('isSupportedLocale', () => {
  it('accepts known locales', () => {
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('nl')).toBe(true);
  });

  it('rejects unknown / malformed locales', () => {
    expect(isSupportedLocale('de')).toBe(false);
    expect(isSupportedLocale('en-US')).toBe(false);
    expect(isSupportedLocale('EN')).toBe(false); // case-sensitive
    expect(isSupportedLocale('')).toBe(false);
    expect(isSupportedLocale(' en ')).toBe(false);
  });
});
