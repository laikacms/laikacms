# @laikacms/documents

[![npm](https://img.shields.io/npm/v/@laikacms/documents)](https://www.npmjs.com/package/@laikacms/documents)
[![npm](https://img.shields.io/npm/dm/@laikacms/documents)](https://www.npmjs.com/package/@laikacms/documents)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/documents)](https://bundlephobia.com/result?p=@laikacms/documents)

Document management with editorial workflow support.

## Installation

```bash
pnpm add @laikacms/documents
```

## Usage

```typescript
import { DocumentsRepository, Document, Unpublished } from '@laikacms/documents'
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
  abstract getDocument(key: string): ResultStream<Document>
  abstract createDocument(create: DocumentCreate): ResultStream<Document>
  abstract getUnpublished(key: string): ResultStream<Unpublished>
  abstract publish(key: string): ResultStream<Document>
  // ...
}
```

## Implementations

- `@laikacms/documents-drizzle` - SQL via Drizzle ORM
- `@laikacms/documents-contentbase` - ContentBase storage
