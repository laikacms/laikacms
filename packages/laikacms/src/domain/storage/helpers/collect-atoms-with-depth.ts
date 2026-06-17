import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import type { LaikaError } from 'laikacms/core';

import type { AtomSummary } from '../domain/entities/index.js';

/**
 * A backend-supplied function that lists the **immediate children** of one
 * folder as a flat array of {@link AtomSummary} values.  It must not recurse.
 *
 * @param folderKey - The storage key of the folder whose direct children
 *   should be returned (empty string means the storage root).
 */
export type ListFolderLevel = (
  folderKey: string,
) => Effect.Effect<AtomSummary[], LaikaError>;

/**
 * Shared depth-traversal helper for `listAtoms` / `listAtomSummaries`.
 *
 * Collects every {@link AtomSummary} reachable from `folderKey` up to
 * `depth` levels deep by calling the backend-supplied `listFolderLevel`
 * callback for each folder encountered.
 *
 * - `depth = 1`: direct children only (no recursion beyond the first call).
 * - `depth = 2`: children and their immediate sub-folders, etc.
 *
 * Failures from sub-folder listings are swallowed (the failing sub-tree is
 * silently omitted) to match the behaviour of all existing per-backend
 * implementations — a single inaccessible nested folder should not abort the
 * entire listing.
 *
 * @param folderKey      - Root folder to start from.
 * @param listFolderLevel - Backend-specific flat lister (no recursion).
 * @param depth          - Maximum traversal depth (≥ 1).
 */
export function collectAtomSummariesWithDepth(
  folderKey: string,
  listFolderLevel: ListFolderLevel,
  depth: number,
): Effect.Effect<AtomSummary[], LaikaError> {
  return Effect.gen(function*() {
    const summaries = yield* listFolderLevel(folderKey);
    if (depth > 1) {
      for (const s of summaries.filter(s => s.type === 'folder-summary')) {
        const nested = yield* Effect.result(
          collectAtomSummariesWithDepth(s.key, listFolderLevel, depth - 1),
        );
        if (Result.isSuccess(nested)) summaries.push(...nested.success);
      }
    }
    return summaries;
  });
}
