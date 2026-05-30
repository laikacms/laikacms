import { describe, expect, it } from 'vitest';
import { collectStream, runTask } from './compat.js';
import { InvalidData } from './domain/index.js';
import * as LaikaStream from './laika-stream.js';
import * as LaikaTask from './laika-task.js';

describe('runTask', () => {
  it('resolves with the task value on success', async () => {
    await expect(runTask(LaikaTask.succeed(42))).resolves.toBe(42);
  });

  it('rejects with the LaikaError on failure', async () => {
    const error = new InvalidData('bad');
    await expect(runTask(LaikaTask.fail(error))).rejects.toBe(error);
  });
});

describe('collectStream', () => {
  it('collects all data values in order', async () => {
    const stream = LaikaStream.succeedMany([1, 2, 3], {});
    const result = await collectStream(stream);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.done).toEqual({});
  });

  it('returns empty items for an empty stream', async () => {
    const done = { total: 0 };
    const stream = LaikaStream.empty(done);
    const result = await collectStream(stream);
    expect(result.items).toEqual([]);
    expect(result.done).toBe(done);
  });

  it('rejects with the LaikaError on stream failure', async () => {
    const error = new InvalidData('stream failed');
    await expect(collectStream(LaikaStream.fail(error))).rejects.toBe(error);
  });

  it('preserves the typed done value', async () => {
    const done = { pagination: { page: 2, pageSize: 10 }, total: 25 };
    const stream = LaikaStream.succeed('only', done);
    const result = await collectStream(stream);
    expect(result.items).toEqual(['only']);
    expect(result.done).toEqual(done);
  });
});
