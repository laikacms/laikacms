import { describe, expect, it } from 'vitest';

import { bearerTokenMatches } from './auth.js';

describe('bearerTokenMatches', () => {
  it('returns true for a correct bearer token', () => {
    expect(bearerTokenMatches('Bearer mysecret', 'mysecret')).toBe(true);
  });

  it('returns false when the token does not match', () => {
    expect(bearerTokenMatches('Bearer wrongtoken', 'mysecret')).toBe(false);
  });

  it('returns false when the header is missing', () => {
    expect(bearerTokenMatches(undefined, 'mysecret')).toBe(false);
  });

  it('returns false for a token that is only a prefix of the expected value', () => {
    expect(bearerTokenMatches('Bearer mysecr', 'mysecret')).toBe(false);
  });

  it('returns false for a token that is a superset of the expected value', () => {
    expect(bearerTokenMatches('Bearer mysecretextra', 'mysecret')).toBe(false);
  });

  it('returns false when the Bearer scheme prefix is absent', () => {
    expect(bearerTokenMatches('mysecret', 'mysecret')).toBe(false);
  });

  it('returns false for an empty header', () => {
    expect(bearerTokenMatches('', 'mysecret')).toBe(false);
  });
});
