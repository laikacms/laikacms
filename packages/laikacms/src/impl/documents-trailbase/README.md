# `laikacms/documents/trailbase`

Documents repository backed by [TrailBase](https://trailbase.io) — a single-binary SQLite
application server with typed Record APIs over HTTP.

## Overview

TrailBase provides a full CRUD REST API over SQLite tables. This module maps that design directly
onto laikacms's document and revision domain contracts:

- **Read and write paths** — all operations (`getDocument`, `createDocument`, `updateDocument`,
  `deleteDocument`, publish/unpublish workflow, revisions) go through TrailBase's Record API
  (`/api/records/v1/<table>`).
- **No inner repository required** — unlike the Electric module, TrailBase handles full state
  management itself.

## Required SQLite schema (TrailBase migrations)

Create these tables in your TrailBase instance's migration directory:

```sql
-- documents table
CREATE TABLE laika_documents (
  id          TEXT PRIMARY KEY DEFAULT (uuid()),
  key         TEXT NOT NULL,
  depth       INTEGER NOT NULL,
  status      TEXT NOT NULL,
  language    TEXT NOT NULL DEFAULT 'und',
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(key)
);
CREATE INDEX idx_laika_documents_status ON laika_documents (status);
CREATE INDEX idx_laika_documents_depth  ON laika_documents (depth);

-- revisions table
CREATE TABLE laika_revisions (
  id          TEXT PRIMARY KEY DEFAULT (uuid()),
  key         TEXT NOT NULL,
  revision    TEXT NOT NULL,
  language    TEXT NOT NULL DEFAULT 'und',
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(key, revision)
);
CREATE INDEX idx_laika_revisions_key ON laika_revisions (key);
```

## Setup

1. Download TrailBase: `curl -sSL https://trailbase.io/install.sh | bash`
2. Run: `trail run --data-dir ./data`
3. Create a Record API for each table in the TrailBase admin UI (or via its CLI).
4. Create an auth token (or use anonymous access if the tables allow it).

See <https://trailbase.io/docs> for full setup instructions.

## Usage

```ts
import { TrailBaseDocumentsRepository } from 'laikacms/documents/trailbase';

const repo = new TrailBaseDocumentsRepository({
  baseUrl: 'http://localhost:4000',
  authToken: process.env.TRAILBASE_TOKEN,
});
```

## Options

| Option           | Type               | Required | Description                                          |
| ---------------- | ------------------ | -------- | ---------------------------------------------------- |
| `baseUrl`        | `string`           | Yes      | Base URL of the TrailBase instance.                  |
| `authToken`      | `string`           | No       | Bearer token for authenticated Record API access.    |
| `documentsTable` | `string`           | No       | Documents table name. Defaults to `laika_documents`. |
| `revisionsTable` | `string`           | No       | Revisions table name. Defaults to `laika_revisions`. |
| `logger`         | `Console`-like     | No       | Receives debug-level tracing.                        |
| `fetch`          | `fetch`-compatible | No       | Override the default `globalThis.fetch`. For tests.  |

## Capabilities

| Capability       | Supported | Notes                                               |
| ---------------- | --------- | --------------------------------------------------- |
| Pagination       | Yes       | Offset/limit via TrailBase `limit`/`offset` params. |
| Version tracking | No        | No row version token exposed by this backend.       |
| Change feed      | No        | No `getSyncToken`/`listChanges` support.            |
| Locks            | No        | Use an external `LocksRepository` if needed.        |
