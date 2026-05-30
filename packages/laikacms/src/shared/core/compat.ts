import * as Result from 'effect/Result';
import { NotFoundError } from './domain/index.js';
import type { LaikaError, LaikaResult } from './domain/index.js';

export async function runTask<T>(
  gen: AsyncGenerator<LaikaResult<T>>,
  opts?: { onProgress?: (result: LaikaResult<T>) => void },
): Promise<T> {
  for await (const result of gen) {
    opts?.onProgress?.(result);
    if (Result.isSuccess(result)) {
      return result.success;
    }
    if (Result.isFailure(result)) {
      throw result.failure;
    }
  }
  throw new NotFoundError('No successful result');
}

export async function collectStream<T>(
  gen: AsyncGenerator<LaikaResult<T>>,
  opts?: { onProgress?: (result: LaikaResult<T>) => void },
): Promise<T[]> {
  const values: T[] = [];
  for await (const result of gen) {
    opts?.onProgress?.(result);
    if (Result.isFailure(result)) {
      throw result.failure;
    }
    values.push(result.success);
  }
  return values;
}
