import { describe, expect, it } from 'vitest';
import { constantTimeEqual, constantTimeEqualBuffer } from './constant-time.js';

describe('constantTimeEqual', () => {
  it('returns true for identical strings', async () => {
    expect(await constantTimeEqual('hello', 'hello')).toBe(true);
  });

  it('returns false for different strings of equal length', async () => {
    expect(await constantTimeEqual('hello', 'world')).toBe(false);
  });

  it('returns false for strings of different length', async () => {
    expect(await constantTimeEqual('a', 'aa')).toBe(false);
  });

  it('returns true for two empty strings', async () => {
    expect(await constantTimeEqual('', '')).toBe(true);
  });

  it('returns false when one string is empty and the other is not', async () => {
    expect(await constantTimeEqual('', 'x')).toBe(false);
  });

  it('handles unicode correctly', async () => {
    expect(await constantTimeEqual('café', 'café')).toBe(true);
    expect(await constantTimeEqual('café', 'cafe')).toBe(false);
  });

  it('distinguishes strings that differ only in their last character', async () => {
    // Defends against early-exit comparisons.
    expect(await constantTimeEqual('abcdef', 'abcdeg')).toBe(false);
  });
});

describe('constantTimeEqualBuffer', () => {
  it('returns true for byte-identical buffers', async () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(await constantTimeEqualBuffer(a, b)).toBe(true);
  });

  it('returns false for buffers that differ in any byte', async () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(await constantTimeEqualBuffer(a, b)).toBe(false);
  });

  it('returns false for buffers of different length', async () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 0]);
    expect(await constantTimeEqualBuffer(a, b)).toBe(false);
  });

  it('returns true for two empty buffers', async () => {
    expect(await constantTimeEqualBuffer(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  it('does not mutate its inputs', async () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    const aCopy = new Uint8Array(a);
    const bCopy = new Uint8Array(b);
    await constantTimeEqualBuffer(a, b);
    expect(a).toEqual(aCopy);
    expect(b).toEqual(bCopy);
  });
});
