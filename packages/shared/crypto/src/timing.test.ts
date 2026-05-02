import { describe, expect, it } from 'vitest';
import { addTimingJitter, withTimingJitter } from './timing.js';

describe('addTimingJitter', () => {
  it('resolves within the requested upper bound (with slack for scheduling)', async () => {
    const start = performance.now();
    await addTimingJitter(20);
    const elapsed = performance.now() - start;
    // The jitter is bounded by `maxJitterMs`; we add generous slack for
    // timer/event-loop overhead so the test isn't flaky.
    expect(elapsed).toBeLessThan(500);
  });

  it('uses the default jitter when no argument is provided', async () => {
    // Just make sure it resolves; the value isn't asserted because it's random.
    await expect(addTimingJitter()).resolves.toBeUndefined();
  });
});

describe('withTimingJitter', () => {
  it('returns the result of the wrapped sync function', async () => {
    const result = await withTimingJitter(() => 42, 5);
    expect(result).toBe(42);
  });

  it('returns the resolved value of an async wrapped function', async () => {
    const result = await withTimingJitter(async () => 'hello', 5);
    expect(result).toBe('hello');
  });

  it('propagates errors thrown by the wrapped function', async () => {
    await expect(
      withTimingJitter(() => {
        throw new Error('boom');
      }, 1),
    ).rejects.toThrow('boom');
  });

  it('runs the wrapped function exactly once', async () => {
    let calls = 0;
    await withTimingJitter(() => {
      calls += 1;
      return calls;
    }, 1);
    expect(calls).toBe(1);
  });
});
