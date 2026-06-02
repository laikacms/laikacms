import type { Result } from 'effect/Result';
import type { LaikaError } from '../entities/index.js';

export type LaikaResult<T> = Result<T, LaikaError>;
