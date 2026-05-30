import * as LaikaStream from './laika-stream.js';
import * as LaikaTask from './laika-task.js';
import type { LaikaDone } from './laika-types.js';

/**
 * Run a {@link LaikaTask} to completion and return its value as a Promise.
 * Rejects with the fatal {@link LaikaError} on failure.
 *
 * This is a Promise-friendly entry point that does not require importing
 * `effect` at the call site.
 */
export const runTask = <A>(task: LaikaTask.LaikaTask<A>): Promise<A> => LaikaTask.runPromise(task);

/**
 * Collect all data items from a {@link LaikaStream} into an array and return
 * `{ items, done }` as a Promise. Rejects with the fatal {@link LaikaError}
 * on failure.
 *
 * This is a Promise-friendly entry point that does not require importing
 * `effect` at the call site.
 */
export const collectStream = async <A, D extends LaikaDone>(
  stream: LaikaStream.LaikaStream<A, D>,
): Promise<{ items: ReadonlyArray<A>, done: D }> => {
  const { data, done } = await LaikaStream.runPromiseCollect(stream);
  return { items: data, done };
};
