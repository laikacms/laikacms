import * as Effect from 'effect/Effect';
import type { LaikaDone, Pagination } from 'laikacms/core';
import { LaikaStream, LaikaTask, NotImplementedError } from 'laikacms/core';
import type { ChangeSummary, Key, Lock, LockOwner, LockToken, OwnedLock, SyncToken } from 'laikacms/storage';
import type {
  Document,
  DocumentCreate,
  DocumentsCapabilities,
  DocumentUpdate,
  Record,
  Revision,
  RevisionCreate,
  RevisionSummary,
  Unpublished,
  UnpublishedCreate,
  UnpublishedUpdate,
} from '../entities/index.js';
import type { RecordSummary } from '../entities/record/record-summary.js';

export interface ListRevisionsOptions {
  pagination: Pagination;
}

export interface ListRecordsOptions {
  pagination: Pagination;
  /**
   * Scope the listing to one collection (`<collection>` or
   * `<collection>/<subfolder>`; the first path segment selects the collection).
   * Omit (or pass an empty string) to list the **root**: each document
   * collection surfaces as a `folder` record (a directory listing), rather
   * than the records inside it.
   */
  folder?: Key | undefined;
  depth: number;
  type?: 'published' | 'unpublished' | undefined;
  statuses?: string[] | undefined;
}

export type ListRecordSummaries = ListRecordsOptions;

/**
 * Done value returned by `listRecords` / `listRecordSummaries` / `listRevisions`.
 * Pagination on the base lets HTTP layers wire next-cursor / total without
 * per-method special cases.
 */
export type ListRecordsDone = LaikaDone;
export type ListRevisionsDone = LaikaDone;

export interface GetSyncTokenOptions {
  /** Scope the token to a folder; omit for the whole store. */
  folder?: string;
}

export interface ListChangesOptions {
  /** A token previously obtained from `getSyncToken` or `listChanges`. */
  since: SyncToken;
  /** Scope the feed to a folder; omit for the whole store. */
  folder?: string;
}

/**
 * Done value returned by `listChanges`. Carries the sync token that captures
 * the state of the scope after the listed changes; pass it as `since` on the
 * next call to resume the feed. Pagination on the base follows the
 * `ListRecordsDone` precedent.
 */
export interface ListChangesDone extends LaikaDone {
  readonly syncToken: SyncToken;
}

export abstract class DocumentsRepository {
  /**
   * Describe what this repository can do — currently which `Pagination` shapes it
   * honors. Consumers can branch on this to skip or adapt looping logic.
   */
  abstract getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities>;

  // Records (all states)
  abstract listRecords(options: ListRecordsOptions): LaikaStream.LaikaStream<Record, ListRecordsDone>;
  abstract listRecordSummaries(
    options: ListRecordSummaries,
  ): LaikaStream.LaikaStream<RecordSummary, ListRecordsDone>;

  // Documents (published)
  abstract getDocument(key: Key): LaikaTask.LaikaTask<Document>;
  abstract createDocument(create: DocumentCreate): LaikaTask.LaikaTask<Document>;
  abstract updateDocument(update: DocumentUpdate): LaikaTask.LaikaTask<Document>;
  abstract deleteDocument(key: Key): LaikaTask.LaikaTask<void>;
  abstract unpublish(key: Key, status: string): LaikaTask.LaikaTask<Unpublished>;

  // Unpublished documents (draft, pending_review, archived, trash, ...)
  abstract getUnpublished(key: Key): LaikaTask.LaikaTask<Unpublished>;
  abstract createUnpublished(create: UnpublishedCreate): LaikaTask.LaikaTask<Unpublished>;
  abstract updateUnpublished(update: UnpublishedUpdate): LaikaTask.LaikaTask<Unpublished>;
  abstract deleteUnpublished(key: Key): LaikaTask.LaikaTask<void>;
  abstract publish(key: Key): LaikaTask.LaikaTask<Document>;

  // Revisions (version history)
  abstract getRevision(key: Key, revision: string): LaikaTask.LaikaTask<Revision>;
  abstract createRevision(create: RevisionCreate): LaikaTask.LaikaTask<Revision>;
  abstract listRevisions(
    key: Key,
    options: ListRevisionsOptions,
  ): LaikaStream.LaikaStream<RevisionSummary, ListRevisionsDone>;

  // Change signals (capability-gated; see DocumentsCapabilities.changes)

  /**
   * Return an opaque token for the given scope (a folder, or the whole store
   * when omitted) that changes whenever anything inside the scope changes.
   * Compare tokens only by equality. A git implementation returns the branch
   * head sha; a database implementation returns a sequence or max(updatedAt).
   *
   * Non-abstract on purpose: existing subclasses stay source-compatible. The
   * base implementation fails with `NotImplementedError`; check
   * `getCapabilities().changes` before calling.
   */
  getSyncToken(options?: GetSyncTokenOptions): LaikaTask.LaikaTask<SyncToken> {
    void options;
    return LaikaTask.fail(
      new NotImplementedError(
        'getSyncToken is not supported by this documents repository. '
          + 'Consult getCapabilities().changes before calling.',
      ),
    );
  }

  /**
   * Enumerate what changed inside the scope since a previously obtained sync
   * token. The done value carries the new sync token to resume from.
   *
   * Non-abstract on purpose: existing subclasses stay source-compatible. The
   * base implementation fails with `NotImplementedError`; check
   * `getCapabilities().changes` before calling.
   */
  listChanges(options: ListChangesOptions): LaikaStream.LaikaStream<ChangeSummary, ListChangesDone> {
    void options;
    return LaikaStream.fail(
      new NotImplementedError(
        'listChanges is not supported by this documents repository. '
          + 'Consult getCapabilities().changes before calling.',
      ),
    );
  }

  // Advisory locking (capability-gated; see DocumentsCapabilities.locks).
  //
  // The lock informs, it does not enforce: nothing here blocks a write. What a
  // held lock buys you is that two editors see the same "being edited by X"
  // signal, arbitrated by the backend instead of by one browser's local state.
  //
  // Authorisation at this seam is the LOCK TOKEN, never the owner identity. The
  // token is an unforgeable bearer capability, so the repository needs no auth
  // plumbing, and a force-override is clean: it mints a new token, and the
  // previous holder's token simply stops matching.
  //
  // All five default to NotImplementedError so existing subclasses stay source
  // compatible; consult `getCapabilities().locks` before calling.

  /**
   * Take the lock on `key`, or fail with `LockConflictError` when someone else
   * holds it (unless `force` is set, which steals it and mints a new token).
   *
   * Returns the lock **including its token** — the only place, besides
   * {@link refreshLock}, the token is ever handed out.
   */
  acquireLock(
    key: Key,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined, force?: boolean | undefined },
  ): LaikaTask.LaikaTask<OwnedLock> {
    void key;
    void owner;
    void options;
    return LaikaTask.fail(
      new NotImplementedError(
        'acquireLock is not supported by this documents repository. '
          + 'Consult getCapabilities().locks before calling.',
      ),
    );
  }

  /**
   * Extend the lock the caller already holds.
   *
   * **Lenient by design:** if the lock has expired or nobody holds it, this
   * re-acquires rather than failing, because an editor whose refresh was late
   * (a slept laptop, a slow network) should keep editing rather than be thrown
   * out of a document nobody else wants. It fails with `LockConflictError` only
   * when someone *else* now holds the lock, which is the case the editor must
   * actually be told about.
   *
   * `owner` is required for that re-acquire branch: reviving an expired lock
   * has to attribute it to somebody, and the caller always knows who it is.
   * (ADR-007 sketches this as `refreshLock(key, token)`; the owner is the one
   * piece that signature cannot supply.)
   */
  refreshLock(
    key: Key,
    token: LockToken,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined },
  ): LaikaTask.LaikaTask<OwnedLock> {
    void key;
    void token;
    void owner;
    void options;
    return LaikaTask.fail(
      new NotImplementedError(
        'refreshLock is not supported by this documents repository. '
          + 'Consult getCapabilities().locks before calling.',
      ),
    );
  }

  /**
   * Release the lock. Only the token-holder can: a non-matching token is a
   * no-op, not an error, so a stale client cannot free someone else's lock and
   * does not need to care that it failed.
   */
  releaseLock(key: Key, token: LockToken): LaikaTask.LaikaTask<void> {
    void key;
    void token;
    return LaikaTask.fail(
      new NotImplementedError(
        'releaseLock is not supported by this documents repository. '
          + 'Consult getCapabilities().locks before calling.',
      ),
    );
  }

  /**
   * Read the current lock, or `null` when the document is free. Returns the
   * **public** projection: no token, so reading a lock never confers the right
   * to release or write through it.
   */
  getLock(key: Key): LaikaTask.LaikaTask<Lock | null> {
    void key;
    return LaikaTask.fail(
      new NotImplementedError(
        'getLock is not supported by this documents repository. '
          + 'Consult getCapabilities().locks before calling.',
      ),
    );
  }

  /**
   * Run `use` while holding the lock on `key`, releasing it afterwards on
   * success, failure, *or* fiber interruption. The TTL is the backstop for the
   * case no release can run at all, i.e. the whole node dies.
   *
   * The default implementation is a bracket: mutual exclusion, **no rollback**
   * of partial writes. A backend with a native transaction overrides this and
   * advertises `transactional: true`; until then a caller that needs atomic
   * multi-write must check the capability rather than assume.
   *
   * The token is threaded explicitly, never through ambient context:
   *
   * ```ts
   * yield* repo.withDocumentLock(key, owner)(lock =>
   *   repo.updateDocument(key, update, { precondition: { ifLockHeldBy: lock.token } })
   * );
   * ```
   */
  withDocumentLock(
    key: Key,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined, force?: boolean | undefined },
  ): <A, R = never>(use: (lock: OwnedLock) => LaikaTask.LaikaTask<A, R>) => LaikaTask.LaikaTask<A, R> {
    return <A, R = never>(use: (lock: OwnedLock) => LaikaTask.LaikaTask<A, R>) =>
      LaikaTask.fromEffect<A, R>(
        Effect.map(
          Effect.acquireUseRelease(
            LaikaTask.runValue(this.acquireLock(key, owner, options)),
            (lock: OwnedLock) => LaikaTask.runValue(use(lock)),
            // Release is best-effort: a failure here must not mask the outcome
            // of `use`, and the TTL reclaims the lock regardless.
            (lock: OwnedLock) => Effect.ignore(LaikaTask.runValue(this.releaseLock(key, lock.token))),
          ),
          value => ({ value }),
        ),
      );
  }
}
