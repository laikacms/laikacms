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

/**
 * A PUSH subscriber. Receives one non-empty batch of {@link ChangeSummary}
 * entries every time the subscribed scope changes. Batches are coalesced by
 * key, so a listener sees at most one entry per key per notification.
 */
export type ChangeListener = (changes: readonly ChangeSummary[]) => void;

/**
 * Tears down a {@link ChangeListener} subscription. Idempotent: calling it more
 * than once is a no-op. When the last listener of a repository unsubscribes,
 * the repository releases any underlying watch resource.
 */
export type Unsubscribe = () => void;

/**
 * Options for `subscribeChanges`.
 *
 * This is the PUSH counterpart to the pull `getSyncToken` / `listChanges` feed:
 * instead of polling, a listener is invoked as changes happen.
 */
export interface SubscribeChangesOptions {
  /** Scope the subscription to a folder; omit for the whole store. */
  folder?: string;
  /**
   * A token previously obtained from the pull feed. Advisory: backends that
   * only support live notifications (no historical replay) ignore it.
   */
  since?: SyncToken;
}
