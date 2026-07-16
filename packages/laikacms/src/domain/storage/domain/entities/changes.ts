import * as S from 'effect/Schema';

/**
 * Opaque per-scope change token.
 *
 * One token covers one scope: a folder, or the whole store when no folder is
 * given. The token changes whenever anything inside the scope changes; it is
 * comparable only by equality and must never be parsed or interpreted. A git
 * branch head sha, a database sequence value, and max(updatedAt) are all
 * valid implementations.
 */
export const SyncToken = S.String.pipe(S.brand('SyncToken'));
export type SyncToken = S.Schema.Type<typeof SyncToken>;

/**
 * One entry of a change feed: the key that changed, the record's new opaque
 * `version` (when the backend tracks per-record versions), and whether the
 * change was a deletion.
 */
export const ChangeSummarySchema = S.toStandardSchemaV1(S.Struct({
  key: S.String,

  /**
   * Opaque per-record version token after the change. Omitted for deletions
   * and on backends without version tracking.
   */
  version: S.optional(S.String),

  /** True when the record was removed from the scope. */
  deleted: S.Boolean,
}));

export type ChangeSummary = S.Schema.Type<typeof ChangeSummarySchema>;
