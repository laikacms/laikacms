# `laikacms/storage/drizzle`

A `StorageRepository` implementation backed by any SQL database via
[Drizzle ORM](https://orm.drizzle.team/). The repository is database-agnostic: you supply
query-builder callbacks and it handles the Laika storage contract. Tested with SQLite (via
`better-sqlite3` and Cloudflare D1), PostgreSQL, and MySQL.

## Usage

```ts
import { and, eq, like, lte } from 'drizzle-orm';
import { DrizzleStorageRepository } from 'laikacms/storage/drizzle';

import { db, storageTable } from './db'; // your Drizzle db instance and table

const repo = new DrizzleStorageRepository({
  queryBuilders: {
    keyEquals: value => eq(storageTable.key, value),
    keyStartsWith: prefix => like(storageTable.key, `${prefix}%`),
    depthLte: value => lte(storageTable.depth, value),
    and: (...conditions) => and(...conditions),
  },
  callbacks: {
    insert: ({ values }) => db.insert(storageTable).values(values).returning(),
    update: ({ where, values }) => db.update(storageTable).set(values).where(where).returning(),
    delete: ({ where }) => db.delete(storageTable).where(where).returning(),
    select: ({ where, limit, offset }) =>
      db.select().from(storageTable).where(where).limit(limit ?? 100).offset(offset ?? 0),
  },
});

const stream = repo.listAtoms('posts/', { depth: 1, pagination: { offset: 0, limit: 50 } });
```

## Constructor

```ts
new DrizzleStorageRepository(options: DrizzleStorageRepositoryOptions)
```

### `DrizzleStorageRepositoryOptions`

| Field           | Type                                                    | Description                                                              |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `queryBuilders` | `DrizzleStorageQueryBuilders`                           | Functions that produce SQL conditions for your specific Drizzle dialect. |
| `callbacks`     | `DrizzleStorageCallbacks`                               | Async functions that execute each class of SQL statement.                |
| `logger`        | `Pick<Console, 'error' \| 'warn' \| 'info' \| 'debug'>` | Optional logger; defaults to no logging.                                 |

### `DrizzleStorageQueryBuilders`

The repository never imports Drizzle directly; instead it asks you to provide condition factories.
Return whatever your Drizzle version produces — the types are `unknown` at the boundary.

| Field           | Signature                               | Description                                                                            |
| --------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| `keyEquals`     | `(value: string) => unknown`            | Exact match on the `key` column.                                                       |
| `keyStartsWith` | `(prefix: string) => unknown`           | Prefix scan on the `key` column (used for folder listings and child-existence checks). |
| `depthLte`      | `(value: number) => unknown`            | Upper bound on the `depth` column (controls recursion depth for `listAtoms`).          |
| `and`           | `(...conditions: unknown[]) => unknown` | Combines multiple conditions with logical AND.                                         |

### `DrizzleStorageCallbacks`

| Field    | Signature                                                                          | Description                                         |
| -------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| `insert` | `({ values: StorageModel }) => Promise<StorageModel[]>`                            | Insert a single row; return the inserted rows.      |
| `update` | `({ where: unknown, values: Partial<StorageModel> }) => Promise<StorageModel[]>`   | Update rows matching `where`; return affected rows. |
| `delete` | `({ where: unknown }) => Promise<StorageModel[]>`                                  | Delete rows matching `where`; return deleted rows.  |
| `select` | `({ where: unknown, limit?: number, offset?: number }) => Promise<StorageModel[]>` | Query rows; apply `LIMIT`/`OFFSET` when provided.   |

### `StorageModel`

The shape of a database row as the repository reads and writes it:

```ts
type StorageModel = {
  key: string, // slash-separated path, e.g. "posts/hello"
  type: string, // object type tag, e.g. "keep-file"
  content: string, // JSON-serialized StorageObjectContent
  depth: number, // number of path segments (used for depth-limited listings)
  createdAt: string, // ISO 8601
  updatedAt: string, // ISO 8601
};
```

## Pagination

Both `offset`/`limit` and page-based (`page`/`perPage`) pagination styles are supported and
translated to SQL `OFFSET`/`LIMIT` by the repository. Cursor pagination is not supported.

Valid `pagination` shapes for `listAtoms` / `listAtomSummaries`:

```ts
{ offset: 0, limit: 50 }     // offset style
{ page: 1, perPage: 50 }     // page style
```

## Behaviour notes

- **Folders.** The repository emulates folders by storing a `.keep` placeholder row
  (`type: 'keep-file'`) when `createFolder` is called. `getFolder` returns a synthetic folder object
  if any child key exists under the given prefix.
- **Depth.** `depth` is stored as the number of slash-separated path segments. `listAtoms` filters
  rows with `depth <= baseDepth + options.depth`.
- **Duplicate keys.** `createObject` fails with `EntryAlreadyExistsError` if the key already exists.
  Use `createOrUpdateObject` for upsert semantics.
- **Safe deletes.** `removeAtoms` refuses to delete a key that is a folder prefix (i.e. has
  children) — the refusal is surfaced as a stream `recoverableError`, not a fatal error.
- **Content serialization.** `StorageObjectContent` is stored as a JSON string in the `content`
  column; invalid JSON on read surfaces as an `InvalidData` recoverableError.

## Known limitations

- **LCMS-179:** Cursor pagination is advertised as unsupported in `getCapabilities()` and is not
  implemented. Pass `offset`/`limit` or `page`/`perPage` instead.
