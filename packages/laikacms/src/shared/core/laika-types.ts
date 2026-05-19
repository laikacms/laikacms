import type * as Arr from 'effect/Array';

import type { LaikaError } from 'laikacms/core';

import type { Pagination } from './domain/types/pagination.js';

/**
 * Base shape for a {@link LaikaStream.LaikaStream}'s terminal OutDone — the
 * "closing return value" emitted after the stream's elements. Methods extend
 * it with their own typed fields.
 *
 * `pagination` matches the `Pagination` request shape: the value describes
 * how to fetch the NEXT page (omitted when there is no next page).
 */
export interface LaikaDone {
  readonly pagination?: Pagination;
  readonly total?: number;
}

/**
 * Progress event. All fields optional so callers may emit partial updates.
 */
export interface LaikaProgress {
  readonly stage?: string;
  readonly current?: number;
  readonly total?: number;
  readonly message?: string;
}

/**
 * Metadata events. Same shape for {@link LaikaStream.LaikaStream} and
 * {@link LaikaTask.LaikaTask} — "recoverable error" and "progress update"
 * are channel positions, not types.
 */
export type LaikaMetadata =
  | { readonly _tag: 'RecoverableError'; readonly error: LaikaError }
  | { readonly _tag: 'Progress'; readonly progress: LaikaProgress };

/**
 * Non-empty chunks (Effect chunks are non-empty by construction).
 */
export type LaikaMetadataChunk = Arr.NonEmptyReadonlyArray<LaikaMetadata>;
