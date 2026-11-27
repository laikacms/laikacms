# `laikacms/storage/trailbase`

Storage repository backed by [TrailBase](https://trailbase.io) — a single-binary SQLite application
server with typed Record APIs over HTTP.

## Overview

Implements the `StorageRepository` contract using TrailBase's Record API
(`/api/records/v1/<table>`). All storage objects are stored as rows with a JSON `content` column.

## Required SQLite schema

```sql
CREATE TABLE laika_storage (
  id          TEXT PRIMARY KEY DEFAULT (uuid()),
  key         TEXT NOT NULL,
  depth       INTEGER NOT NULL,
  type        TEXT NOT NULL DEFAULT 'object',
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(key)
);
CREATE INDEX idx_laika_storage_depth ON laika_storage (depth);
```

## Usage

```ts
import { TrailBaseStorageRepository } from 'laikacms/storage/trailbase';

const repo = new TrailBaseStorageRepository({
  baseUrl: 'http://localhost:4000',
  authToken: process.env.TRAILBASE_TOKEN,
});
```

## Options

| Option         | Type               | Required | Description                                         |
| -------------- | ------------------ | -------- | --------------------------------------------------- |
| `baseUrl`      | `string`           | Yes      | Base URL of the TrailBase instance.                 |
| `authToken`    | `string`           | No       | Bearer token for authenticated Record API access.   |
| `storageTable` | `string`           | No       | Table name. Defaults to `laika_storage`.            |
| `logger`       | `Console`-like     | No       | Receives debug-level tracing.                       |
| `fetch`        | `fetch`-compatible | No       | Override the default `globalThis.fetch`. For tests. |

## Capabilities

| Capability      | Supported | Notes                                               |
| --------------- | --------- | --------------------------------------------------- |
| Pagination      | Yes       | Offset/limit via TrailBase `limit`/`offset` params. |
| File extensions | No        | SQL storage has no inherent file extension concept. |
| Change feed     | No        | No `getSyncToken`/`listChanges` support.            |
