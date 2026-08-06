import { describe, expect, it } from 'vitest';
import { addTimingJitter, withTimingJitter } from './timing.js';

describe('addTimingJitter', () => {
  it('resolves without throwing using default maxJitterMs', async () => {
    await expect(addTimingJitter()).resolves.toBeUndefined();
  });

  it('resolves without throwing with a custom maxJitterMs', async () => {
    await expect(addTimingJitter(10)).resolves.toBeUndefined();
  });

  it('resolves without throwing when maxJitterMs is 1', async () => {
    await expect(addTimingJitter(1)).resolves.toBeUndefined();
  });
});

describe('withTimingJitter', () => {
  it('returns the result of a synchronous fn', async () => {
    const result = await withTimingJitter(() => 42, 1);
    expect(result).toBe(42);
  });

  it('returns the result of an async fn', async () => {
    const result = await withTimingJitter(async () => 'hello', 1);
    expect(result).toBe('hello');
  });

  it('works with a fn that returns undefined', async () => {
    const result = await withTimingJitter(() => undefined, 1);
    expect(result).toBeUndefined();
  });

  it('propagates errors thrown by fn', async () => {
    await expect(
      withTimingJitter(() => {
        throw new Error('boom');
      }, 1),
    ).rejects.toThrow('boom');
  });
});
