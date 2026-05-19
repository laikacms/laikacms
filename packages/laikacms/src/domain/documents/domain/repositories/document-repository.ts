import type { LaikaDone, LaikaStream, LaikaTask, Pagination } from 'laikacms/core';
import type { Key } from 'laikacms/storage';
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
}
