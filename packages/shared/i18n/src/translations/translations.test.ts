import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { nl } from './nl.js';

describe('translations', () => {
  it('en is the source of truth (every key has a non-empty string)', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(typeof value, key).toBe('string');
      expect(value.length, key).toBeGreaterThan(0);
    }
  });

  it('nl has a translation for every en key', () => {
    const enKeys = Object.keys(en).sort();
    const nlKeys = Object.keys(nl).sort();
    expect(nlKeys).toEqual(enKeys);
  });

  it('nl has no empty translations', () => {
    for (const [key, value] of Object.entries(nl)) {
      expect(typeof value, key).toBe('string');
      expect(value.length, key).toBeGreaterThan(0);
    }
  });
});
