import type {
  Revision,
  RevisionSummary,
  RevisionCreate,
  Document,
  DocumentCreate,
  Unpublished,
  UnpublishedCreate,
  UnpublishedUpdate,
  Record as DocumentRecord,
  DocumentUpdate,
  UnpublishedSummary,
  DocumentSummary,
  Record,
} from '../entities/index.js'
import { Key, Pagination } from '@laikacms/storage'
import { RecordSummary } from '../entities/record/record-summary.js'
import * as Result from 'effect/Result'
import { LaikaError, LaikaResult } from '@laikacms/core'

export interface ListRevisionsOptions {
  pagination: Pagination,
}

export interface ListRecordsOptions {
  pagination: Pagination,
  folder: Key,
  depth: number,
  type?: 'published' | 'unpublished' | undefined,
  statuses?: string[] | undefined,
}

export type ListRecordSummaries = ListRecordsOptions

type ResultStream<T> = AsyncGenerator<LaikaResult<T>>;

export abstract class DocumentsRepository {
  // Records (all states)
  abstract listRecords(options: ListRecordsOptions): ResultStream<readonly Record[]>
  abstract listRecordSummaries(options: ListRecordSummaries): ResultStream<readonly RecordSummary[]>

  // Documents (published)
  abstract getDocument(key: Key): ResultStream<Document>
  abstract createDocument(create: DocumentCreate): ResultStream<Document>
  abstract updateDocument(update: DocumentUpdate): ResultStream<Document>
  abstract deleteDocument(key: Key): ResultStream<void>
  abstract unpublish(key: Key, status: string): ResultStream<Unpublished>

  // Unpublished documents (with status like draft, pending_review, archived, trash)
  abstract getUnpublished(key: Key): ResultStream<Unpublished>
  abstract createUnpublished(create: UnpublishedCreate): ResultStream<Unpublished>
  abstract updateUnpublished(update: UnpublishedUpdate): ResultStream<Unpublished>
  abstract deleteUnpublished(key: Key): ResultStream<void>
  abstract publish(key: Key): ResultStream<Document>

  // Revisions (version history)
  abstract getRevision(key: Key, revision: string): ResultStream<Revision>
  abstract createRevision(create: RevisionCreate): ResultStream<Revision>
  abstract listRevisions(key: Key, options: ListRevisionsOptions): ResultStream<readonly RevisionSummary[]>
}
