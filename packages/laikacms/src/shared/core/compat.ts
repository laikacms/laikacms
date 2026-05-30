import * as Effect from 'effect/Effect';

import { isData } from './laika-element.js';
import * as LaikaStream from './laika-stream.js';
import * as LaikaTask from './laika-task.js';
import type { LaikaDone, LaikaMetadata } from './laika-types.js';

export interface CompatOptions {
  readonly onProgress?: (metadata: LaikaMetadata) => void;
}

/**
 * Run a {@link LaikaTask} to completion and return its value as a Promise.
 * Rejects with the fatal {@link LaikaError} on failure.
 *
 * Pass `onProgress` to receive each {@link LaikaMetadata} event (progress +
 * recoverable errors) as the task runs.
 *
 * This is a Promise-friendly entry point that does not require importing
 * `effect` at the call site.
 */
export const runTask = <A>(task: LaikaTask.LaikaTask<A>, options?: CompatOptions): Promise<A> => {
  const { onProgress } = options ?? {};
  if (!onProgress) return LaikaTask.runPromise(task);
  return Effect.runPromise(
    LaikaTask.drainWithValue(task, chunk => {
      for (const meta of chunk) onProgress(meta);
      return Effect.void;
    }),
  );
};

/**
 * Collect all data items from a {@link LaikaStream} into an array and return
 * `{ items, done }` as a Promise. Rejects with the fatal {@link LaikaError}
 * on failure.
 *
 * Pass `onProgress` to receive each {@link LaikaMetadata} event (progress +
 * recoverable errors) as the stream runs. Data elements are NOT forwarded to
 * the callback — they are collected into `items` as usual.
 *
 * This is a Promise-friendly entry point that does not require importing
 * `effect` at the call site.
 */
export const collectStream = async <A, D extends LaikaDone>(
  stream: LaikaStream.LaikaStream<A, D>,
  options?: CompatOptions,
): Promise<{ items: ReadonlyArray<A>, done: D }> => {
  const { onProgress } = options ?? {};
  if (!onProgress) {
    const { data, done } = await LaikaStream.runPromiseCollect(stream);
    return { items: data, done };
  }
  const items: A[] = [];
  const done = await Effect.runPromise(
    LaikaStream.drainWithDone(stream, chunk => {
      for (const el of chunk) {
        if (isData(el)) items.push(el.value);
        else onProgress(el);
      }
      return Effect.void;
    }),
  );
  return { items, done };
};
