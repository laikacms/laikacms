# laikacms/documents

[![npm](https://img.shields.io/npm/v/laikacms)](https://www.npmjs.com/package/laikacms)
[![npm](https://img.shields.io/npm/dm/laikacms)](https://www.npmjs.com/package/laikacms)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/laikacms)](https://bundlephobia.com/result?p=laikacms)

Document management with editorial workflow support.

## Installation

```bash
pnpm add laikacms
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
  abstract getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities>;

  // Records (all states)
  abstract listRecords(
    options: ListRecordsOptions,
  ): LaikaStream.LaikaStream<Record, ListRecordsDone>;
  abstract listRecordSummaries(
    options: ListRecordSummaries,
  ): LaikaStream.LaikaStream<RecordSummary, ListRecordsDone>;

  // Documents (published)
  abstract getDocument(key: Key): LaikaTask.LaikaTask<Document>;
  abstract createDocument(create: DocumentCreate): LaikaTask.LaikaTask<Document>;
  abstract updateDocument(update: DocumentUpdate): LaikaTask.LaikaTask<Document>;
  abstract deleteDocument(key: Key): LaikaTask.LaikaTask<void>;
  abstract unpublish(key: Key, status: string): LaikaTask.LaikaTask<Unpublished>;

  // Unpublished documents (draft, pending_review, archived, trash, …)
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
```

`LaikaTask.LaikaTask<T>` resolves to a single value (like a Promise).
`LaikaStream.LaikaStream<T, Done>` emits multiple values then a done value. Both come from
`laikacms/core`. `Key` comes from `laikacms/storage`. `ListRecordsDone` and `ListRevisionsDone` are
type aliases for `LaikaDone` (carries pagination and total).

## Implementations

- `laikacms/documents/drizzle` - SQL via Drizzle ORM
- `laikacms/documents/contentbase` - ContentBase storage
- `laikacms/documents/jsonapi-proxy` - JSON:API proxy (remote repository over HTTP)
- `laikacms/documents/obsidian` - Obsidian vault (published state via frontmatter)
