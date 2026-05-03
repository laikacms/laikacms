import { describe, expect, it } from 'vitest';
import { generateSecureRandomBytes, generateSecureRandomHex, generateSecureRandomString } from './random.js';

describe('generateSecureRandomString', () => {
  it('returns a string of the requested length', () => {
    for (const len of [1, 16, 32, 64, 100]) {
      expect(generateSecureRandomString(len).length).toBe(len);
    }
  });

  it('only emits characters from the supplied alphabet (base62 default)', () => {
    const out = generateSecureRandomString(512);
    expect(out).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('respects a custom alphabet', () => {
    const out = generateSecureRandomString(256, 'abc');
    expect(out).toMatch(/^[abc]+$/);
  });

  it('has reasonable entropy across the alphabet', () => {
    // Sample a long string and confirm we see most of the alphabet, which
    // would not happen if rejection sampling were broken.
    const sample = generateSecureRandomString(10_000);
    const unique = new Set(sample).size;
    expect(unique).toBeGreaterThan(50); // base62 has 62 chars
  });

  it('handles length 0', () => {
    expect(generateSecureRandomString(0)).toBe('');
  });
});

describe('generateSecureRandomHex', () => {
  it('returns hex characters of the requested length', () => {
    const out = generateSecureRandomHex(48);
    expect(out.length).toBe(48);
    expect(out).toMatch(/^[0-9a-f]+$/);
  });
});

describe('generateSecureRandomBytes', () => {
  it('returns a Uint8Array of the requested length', () => {
    const out = generateSecureRandomBytes(32);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(32);
  });
});
