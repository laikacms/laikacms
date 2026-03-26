import { Result } from '@laikacms/core'

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
import { Pagination } from '@laikacms/storage'
import { RecordSummary } from '../entities/record/record-summary.js'

export interface ListRevisionsOptions {
  pagination: Pagination,
}

export interface ListRecordsOptions {
  pagination: Pagination,
  folder: string,
  depth: number,
  type?: 'published' | 'unpublished' | undefined,
  statuses?: string[] | undefined,
}

export type ListRecordSummaries = ListRecordsOptions

export abstract class DocumentsRepository {
  // Records (all states)
  abstract listRecords(options: ListRecordsOptions): AsyncGenerator<Result<readonly Record[]>>
  abstract listRecordSummaries(options: ListRecordSummaries): AsyncGenerator<Result<readonly RecordSummary[]>>

  // Documents (published)
  abstract getDocument(key: string): Promise<Result<Document>>
  abstract createDocument(create: DocumentCreate): Promise<Result<Document>>
  abstract updateDocument(update: DocumentUpdate): Promise<Result<Document>>
  abstract deleteDocument(key: string): Promise<Result<void>>
  abstract unpublish(key: string, status: string): Promise<Result<Unpublished>>

  // Unpublished documents (with status like draft, pending_review, archived, trash)
  abstract getUnpublished(key: string): Promise<Result<Unpublished>>
  abstract createUnpublished(create: UnpublishedCreate): Promise<Result<Unpublished>>
  abstract updateUnpublished(update: UnpublishedUpdate): Promise<Result<Unpublished>>
  abstract deleteUnpublished(key: string): Promise<Result<void>>
  abstract publish(key: string): Promise<Result<Document>>

  // Revisions (version history)
  abstract getRevision(key: string, revision: string): Promise<Result<Revision>>
  abstract createRevision(create: RevisionCreate): Promise<Result<Revision>>
  abstract listRevisions(key: string, options: ListRevisionsOptions): AsyncGenerator<Result<readonly RevisionSummary[]>>
}
