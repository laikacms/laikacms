# `laikacms/documents/electric`

Documents repository backed by [ElectricSQL](https://electric-sql.com) for the read path, with any
other `DocumentsRepository` as the write backend.

## Overview

Electric is a read-path sync engine over Postgres. Clients subscribe to "shapes" (partial table
replicas) via plain HTTP; writes go through your own API. This module maps that design onto
laikacms's domain repository split:

- **Read path** — `getDocument`, `listRecords`, `listRecordSummaries`, `getUnpublished` fetch the
  current shape snapshot from Electric's HTTP endpoint.
- **Write path** — all mutations (`createDocument`, `updateDocument`, `deleteDocument`,
  publish/unpublish workflow, revisions) delegate to an inner `DocumentsRepository` (e.g.
  `DrizzleDocumentsRepository`). Electric syncs the changes back to subscribers on its own schedule.

## Required Postgres schema

```sql
CREATE TABLE laika_documents (
  key         TEXT PRIMARY KEY,
  depth       INTEGER NOT NULL,
  status      TEXT    NOT NULL,
  language    TEXT    NOT NULL DEFAULT 'und',
  content     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
```

## Setup

Run [ElectricSQL](https://electric-sql.com/docs/quickstart) pointing at the Postgres database that
holds `laika_documents`. The service exposes a `/v1/shape` HTTP endpoint that this repository polls.

## Usage

```ts
import { DrizzleDocumentsRepository } from 'laikacms/documents/drizzle';
import { ElectricDocumentsRepository } from 'laikacms/documents/electric';

const writeRepo = new DrizzleDocumentsRepository({/* drizzle options */});

const repo = new ElectricDocumentsRepository({
  baseUrl: 'http://localhost:3000', // Electric service URL
  table: 'laika_documents', // Postgres table name (default)
  innerRepo: writeRepo, // handles all writes
});
```

## Options

| Option      | Type                  | Required | Description                                                |
| ----------- | --------------------- | -------- | ---------------------------------------------------------- |
| `baseUrl`   | `string`              | Yes      | Base URL of the Electric service.                          |
| `table`     | `string`              | No       | Postgres table name. Defaults to `laika_documents`.        |
| `innerRepo` | `DocumentsRepository` | Yes      | Write-path repository.                                     |
| `logger`    | `Console`-like        | No       | Receives debug-level tracing.                              |
| `fetch`     | `fetch`-compatible    | No       | Override the default `globalThis.fetch`. Useful for tests. |

## Capabilities

| Capability       | Supported | Notes                                                  |
| ---------------- | --------- | ------------------------------------------------------ |
| Pagination       | Yes       | In-process offset/limit slicing of the shape snapshot. |
| Version tracking | No        | Electric carries no version token column.              |
| Change feed      | No        | Use the `innerRepo`'s change feed if it supports one.  |
| Locks            | No        | Delegate lock operations to the `innerRepo`.           |
