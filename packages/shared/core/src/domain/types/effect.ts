import type { Result } from 'effect/Result';
import type { Stream } from 'effect/Stream';
import { LaikaError } from '../entities';

export type LaikaResult<T> = Result<T, LaikaError>;
