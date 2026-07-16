import type { LaikaDone, Pagination } from 'laikacms/core';
import { LaikaStream, LaikaTask, NotImplementedError } from 'laikacms/core';
import type { ChangeSummary, Key, SyncToken } from 'laikacms/storage';
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
  folder: Key;
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
}
