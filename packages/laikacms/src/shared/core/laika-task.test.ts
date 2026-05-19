import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import { describe, expect, it } from 'vitest';

import { NotFoundError } from 'laikacms/core';

import * as Task from './laika-task.js';
import type { LaikaTask } from './laika-task.js';
import type { LaikaMetadataChunk, LaikaProgress } from './laika-types.js';

async function drainTask<A>(
  task: LaikaTask<A>,
): Promise<{ chunks: LaikaMetadataChunk[], value: A | undefined }> {
  const it = task[Symbol.asyncIterator]();
  const chunks: LaikaMetadataChunk[] = [];
  let value: A | undefined;
  while (true) {
    const step = await it.next();
    if (step.done) {
      value = step.value;
      break;
    }
    chunks.push(step.value);
  }
  return { chunks, value };
}

describe('LaikaTask — basic constructors', () => {
  it('succeed(value) yields no metadata; iterator return-value is the value', async () => {
    const { chunks, value } = await drainTask(Task.succeed(42));
    expect(chunks).toEqual([]);
    expect(value).toBe(42);
  });

  it('fail(error) throws the LaikaError from the iterator', async () => {
    const err = new NotFoundError('boom');
    const it = Task.fail(err)[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toBe(err);
  });

  it('fromEffect emits warnings then resolves to the value', async () => {
    const w = new NotFoundError('warn');
    const task = Task.fromEffect(
      Effect.succeed({ value: 'final', recoverableErrors: [w] }),
    );
    const { chunks, value } = await drainTask(task);
    expect(value).toBe('final');
    expect(chunks.flatMap(c => Array.from(c))).toEqual([
      { _tag: 'RecoverableError', error: w },
    ]);
  });

  it('fromEffect failure surfaces as fatal', async () => {
    const err = new NotFoundError('fail');
    const task = Task.fromEffect(Effect.fail(err) as Effect.Effect<never, NotFoundError>);
    const it = (task as LaikaTask<never>)[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toBe(err);
  });
});

describe('LaikaTask — make builder', () => {
  it('emits warnings and progress; resolves to the builder return value', async () => {
    const w = new NotFoundError('warn');
    const task = Task.make<string>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'start' });
        yield* emit.recoverableError(w);
        yield* emit.progress({ stage: 'end' });
        return 'done';
      })
    );
    const { chunks, value } = await drainTask(task);
    expect(value).toBe('done');
    const flat = chunks.flatMap(c => Array.from(c));
    expect(flat[0]).toEqual({ _tag: 'Progress', progress: { stage: 'start' } });
    expect(flat[1]).toEqual({ _tag: 'RecoverableError', error: w });
    expect(flat[2]).toEqual({ _tag: 'Progress', progress: { stage: 'end' } });
  });

  it('make builder failure throws fatal error', async () => {
    const err = new NotFoundError('halt');
    const task = Task.make<string>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'before' });
        return yield* Effect.fail(err);
      })
    );
    const it = task[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.done).toBe(false);
    await expect(it.next()).rejects.toBe(err);
  });
});

describe('LaikaTask — run helpers', () => {
  it('runValue ignores metadata, returns the resolved value', async () => {
    const task = Task.make<number>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'mid' });
        return 99;
      })
    );
    const value = await Effect.runPromise(Task.runValue(task));
    expect(value).toBe(99);
  });

  it('runCollect bucketises metadata and returns value', async () => {
    const w = new NotFoundError('w');
    const task = Task.make<string>(emit =>
      Effect.gen(function*() {
        yield* emit.recoverableError(w);
        yield* emit.progress({ stage: 'done' });
        return 'ok';
      })
    );
    const result = await Effect.runPromise(Task.runCollect(task));
    expect(result.value).toBe('ok');
    expect(result.recoverableErrors).toEqual([w]);
    expect(result.progress).toEqual([{ stage: 'done' }]);
  });

  it('runValue surfaces fatal errors as Effect failure', async () => {
    const err = new NotFoundError('boom');
    const exit = await Effect.runPromiseExit(Task.runValue(Task.fail(err)));
    expect(exit._tag).toBe('Failure');
  });

  it('tapWarnings observes each warning, preserves the task', async () => {
    const observed: string[] = [];
    const w1 = new NotFoundError('w1');
    const w2 = new NotFoundError('w2');
    const task = Task.make<number>(emit =>
      Effect.gen(function*() {
        yield* emit.recoverableError(w1);
        yield* emit.recoverableError(w2);
        return 7;
      })
    );
    const tapped = Task.tapRecoverableErrors(task, err => {
      observed.push(err.message);
      return Effect.void;
    });
    const result = await Effect.runPromise(Task.runCollect(tapped));
    expect(observed).toEqual(['w1', 'w2']);
    expect(result.value).toBe(7);
    expect(result.recoverableErrors).toEqual([w1, w2]);
  });

  it('tapProgress observes each progress event', async () => {
    const observed: LaikaProgress[] = [];
    const task = Task.make<number>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'a' });
        yield* emit.progress({ stage: 'b' });
        return 0;
      })
    );
    const tapped = Task.tapProgress(task, p => {
      observed.push(p);
      return Effect.void;
    });
    await Effect.runPromise(Task.runValue(tapped));
    expect(observed).toEqual([{ stage: 'a' }, { stage: 'b' }]);
  });
});

describe('LaikaTask — Promise helpers (non-Effect consumers)', () => {
  it('runPromise resolves with the value', async () => {
    const task = Task.make<number>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'mid' });
        return 42;
      })
    );
    await expect(Task.runPromise(task)).resolves.toBe(42);
  });

  it('runPromise rejects with the fatal LaikaError', async () => {
    const err = new NotFoundError('boom');
    await expect(Task.runPromise(Task.fail(err))).rejects.toBe(err);
  });

  it('runPromiseCollect resolves with value + bucketed metadata', async () => {
    const w = new NotFoundError('w');
    const task = Task.make<string>(emit =>
      Effect.gen(function*() {
        yield* emit.recoverableError(w);
        yield* emit.progress({ stage: 'done' });
        return 'ok';
      })
    );
    const out = await Task.runPromiseCollect(task);
    expect(out.value).toBe('ok');
    expect(out.recoverableErrors).toEqual([w]);
    expect(out.progress).toEqual([{ stage: 'done' }]);
  });

  it('runPromiseResult captures fatal failure as a LaikaResult', async () => {
    const err = new NotFoundError('caught');
    const r = await Task.runPromiseResult(Task.fail(err));
    expect(Result.isFailure(r)).toBe(true);
    if (Result.isFailure(r)) expect(r.failure).toBe(err);
  });

  it('runPromiseResult captures success as a LaikaResult', async () => {
    const r = await Task.runPromiseResult(Task.succeed(7));
    expect(Result.isSuccess(r)).toBe(true);
    if (Result.isSuccess(r)) expect(r.success).toBe(7);
  });
});

describe('LaikaTask — combinators', () => {
  it('map transforms the resolved value', async () => {
    const task = Task.succeed(5);
    const mapped = Task.map(task, n => `n${n}`);
    const value = await Effect.runPromise(Task.runValue(mapped));
    expect(value).toBe('n5');
  });

  it('map preserves metadata', async () => {
    const w = new NotFoundError('w');
    const task = Task.make<number>(emit =>
      Effect.gen(function*() {
        yield* emit.recoverableError(w);
        return 10;
      })
    );
    const mapped = Task.map(task, n => n * 2);
    const result = await Effect.runPromise(Task.runCollect(mapped));
    expect(result.value).toBe(20);
    expect(result.recoverableErrors).toEqual([w]);
  });
});
