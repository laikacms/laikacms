import type { Result } from 'effect/Result';
import type { LaikaError } from '../entities';

export type LaikaResult<T> = Result<T, LaikaError>;
