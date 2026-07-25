import * as Result from 'effect/Result';
import type { LaikaError, LaikaResult } from './domain/index.js';

/**
 * AsyncGenerator helpers. Split out of `utilities.ts` on purpose:
 * `accumulateFirst` needs `effect/Result`, and keeping it in utilities made
 * every consumer of a trivial helper (`memoize`, `Url`, ...) drag the effect
 * graph into its bundle. `utilities.ts` must stay dependency-free - add
 * anything that imports effect (or any other runtime dep) HERE or in its own
 * module, never there.
 */
export const AsyncGenerator = {
  toArray: async <T>(gen: AsyncGenerator<T>): Promise<T[]> => {
    const result: T[] = [];
    for await (const item of gen) {
      result.push(item);
    }
    return result;
  },
  first: async <T>(gen: AsyncGenerator<T>): Promise<T | undefined> => {
    for await (const item of gen) {
      return item;
    }
    return undefined;
  },
  accumulateFirst: async <T>(gen: AsyncGenerator<LaikaResult<T>>): Promise<Result.Result<T, LaikaError[]>> => {
    const errors: LaikaError[] = [];
    for await (const item of gen) {
      if (Result.isSuccess(item)) {
        return Result.succeed(item.success);
      } else if (Result.isFailure(item)) {
        errors.push(item.failure);
      }
    }
    return Result.fail(errors);
  },
};
