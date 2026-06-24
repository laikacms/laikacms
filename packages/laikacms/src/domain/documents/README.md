# laikacms/documents

[![npm](https://img.shields.io/npm/v/laikacms/documents)](https://www.npmjs.com/package/laikacms/documents)
[![npm](https://img.shields.io/npm/dm/laikacms/documents)](https://www.npmjs.com/package/laikacms/documents)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/laikacms/documents)](https://bundlephobia.com/result?p=laikacms/documents)

Document management with editorial workflow support.

## Installation

```bash
pnpm add laikacms/documents
```

## Usage

```typescript
import { Document, DocumentsRepository, Unpublished } from 'laikacms/documents';
```

## Entities

- `Document` - Published document
- `Unpublished` - Draft/pending document
- `Revision` - Document revision history

## Editorial Workflow

```
Draft → Pending Review → Pending Publish → Published
```

## Repository Interface

```typescript
abstract class DocumentsRepository {
  abstract getCapabilities(): LaikaTask<DocumentsCapabilities>;

  // Records (all states)
  abstract listRecords(options: ListRecordsOptions): LaikaStream<Record, ListRecordsDone>;
  abstract listRecordSummaries(
    options: ListRecordSummaries,
  ): LaikaStream<RecordSummary, ListRecordsDone>;

  // Documents (published)
  abstract getDocument(key: string): LaikaTask<Document>;
  abstract createDocument(create: DocumentCreate): LaikaTask<Document>;
  abstract updateDocument(update: DocumentUpdate): LaikaTask<Document>;
  abstract deleteDocument(key: string): LaikaTask<void>;
  abstract unpublish(key: string, status: string): LaikaTask<Unpublished>;

  // Unpublished documents (draft, pending_review, …)
  abstract getUnpublished(key: string): LaikaTask<Unpublished>;
  abstract createUnpublished(create: UnpublishedCreate): LaikaTask<Unpublished>;
  abstract updateUnpublished(update: UnpublishedUpdate): LaikaTask<Unpublished>;
  abstract deleteUnpublished(key: string): LaikaTask<void>;
  abstract publish(key: string): LaikaTask<Document>;

  // Revisions (version history)
  abstract getRevision(key: string, revision: string): LaikaTask<Revision>;
  abstract createRevision(create: RevisionCreate): LaikaTask<Revision>;
  abstract listRevisions(
    key: string,
    options: ListRevisionsOptions,
  ): LaikaStream<RevisionSummary, ListRevisionsDone>;
}
```

`LaikaTask<T>` resolves to a single value (like a Promise). `LaikaStream<T, Done>` emits multiple
values then a done value. Both come from `laikacms/core`. `ListRecordsDone` and `ListRevisionsDone`
are type aliases for `LaikaDone` (carries pagination and total).

## Implementations

- `laikacms/documents-drizzle` - SQL via Drizzle ORM
- `laikacms/documents-contentbase` - ContentBase storage
- `laikacms/documents-obsidian` - Obsidian vault (published state via frontmatter)
