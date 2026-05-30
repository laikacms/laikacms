import * as Result from 'effect/Result';
import { describe, expect, it, vi } from 'vitest';
import { collectStream, runTask } from './compat.js';
import type { LaikaResult } from './domain/index.js';
import { InvalidData, NotFoundError } from './domain/index.js';

async function* makeGen<T>(items: LaikaResult<T>[]): AsyncGenerator<LaikaResult<T>> {
  for (const item of items) {
    yield item;
  }
}

describe('runTask', () => {
  it('returns the value from the first success result', async () => {
    const gen = makeGen([Result.succeed(42)]);
    await expect(runTask(gen)).resolves.toBe(42);
  });

  it('throws the LaikaError on failure', async () => {
    const error = new InvalidData('bad');
    const gen = makeGen<number>([Result.fail(error)]);
    await expect(runTask(gen)).rejects.toBe(error);
  });

  it('throws NotFoundError when generator exhausts without success', async () => {
    const gen = makeGen<number>([]);
    await expect(runTask(gen)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('calls onProgress for each item', async () => {
    const onProgress = vi.fn();
    const success = Result.succeed('hello');
    const gen = makeGen([success]);
    await runTask(gen, { onProgress });
    expect(onProgress).toHaveBeenCalledWith(success);
  });

  it('returns the first success and stops', async () => {
    const onProgress = vi.fn();
    const gen = makeGen([Result.succeed(1), Result.succeed(2)]);
    const value = await runTask(gen, { onProgress });
    expect(value).toBe(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });
});

describe('collectStream', () => {
  it('collects all success values in order', async () => {
    const gen = makeGen([Result.succeed(1), Result.succeed(2), Result.succeed(3)]);
    await expect(collectStream(gen)).resolves.toEqual([1, 2, 3]);
  });

  it('throws LaikaError on first failure', async () => {
    const error = new InvalidData('nope');
    const gen = makeGen<number>([Result.succeed(1), Result.fail(error), Result.succeed(3)]);
    await expect(collectStream(gen)).rejects.toBe(error);
  });

  it('returns empty array for empty generator', async () => {
    const gen = makeGen<string>([]);
    await expect(collectStream(gen)).resolves.toEqual([]);
  });

  it('calls onProgress for each item', async () => {
    const onProgress = vi.fn();
    const items = [Result.succeed('a'), Result.succeed('b')];
    const gen = makeGen(items);
    await collectStream(gen, { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, items[0]);
    expect(onProgress).toHaveBeenNthCalledWith(2, items[1]);
  });
});
