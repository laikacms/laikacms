# `laikacms/documents-drizzle`

A `DocumentsRepository` implementation backed by any SQL database via
[Drizzle ORM](https://orm.drizzle.team/). The repository is database-agnostic: you supply
query-builder callbacks and it handles the full Laika documents contract — published records,
unpublished drafts, and revision history.

## Usage

```ts
import { eq, ne, inArray, and, like, lte } from 'drizzle-orm';
import { DrizzleDocumentsRepository } from 'laikacms/documents-drizzle';

import { db, documentsTable, revisionsTable } from './db';

const repo = new DrizzleDocumentsRepository({
  documentQueryBuilders: {
    keyEquals:     (v) => eq(documentsTable.key, v),
    keyStartsWith: (p) => like(documentsTable.key, `${p}%`),
    statusEquals:  (v) => eq(documentsTable.status, v),
    statusNotEquals: (v) => ne(documentsTable.status, v),
    statusIn:      (vs) => inArray(documentsTable.status, vs),
    depthLte:      (v) => lte(documentsTable.depth, v),
    and:           (...conds) => and(...conds),
  },
  revisionQueryBuilders: {
    keyEquals:      (v) => eq(revisionsTable.key, v),
    revisionEquals: (v) => eq(revisionsTable.revision, v),
    and:            (...conds) => and(...conds),
  },
  callbacks: {
    documents: {
      insert: ({ values }) =>
        db.insert(documentsTable).values(values).returning(),
      update: ({ where, values }) =>
        db.update(documentsTable).set(values).where(where).returning(),
      delete: ({ where }) =>
        db.delete(documentsTable).where(where).returning(),
      select: ({ where, limit, offset, excludeContent }) =>
        db
          .select(excludeContent
            ? { key: documentsTable.key, depth: documentsTable.depth, status: documentsTable.status, language: documentsTable.language, content: documentsTable.content, createdAt: documentsTable.createdAt, updatedAt: documentsTable.updatedAt }
            : undefined)
          .from(documentsTable)
          .where(where)
          .limit(limit ?? 100)
          .offset(offset ?? 0),
    },
    revisions: {
      insert: ({ values }) =>
        db.insert(revisionsTable).values(values).returning(),
      update: ({ where, values }) =>
        db.update(revisionsTable).set(values).where(where).returning(),
      delete: ({ where }) =>
        db.delete(revisionsTable).where(where).returning(),
      select: ({ where, limit }) =>
        db.select().from(revisionsTable).where(where).limit(limit ?? 100),
    },
  },
});

const { items } = await collectStream(
  repo.listRecords({ type: 'published', depth: 1, pagination: { offset: 0, limit: 50 } }),
);
```

## Constructor

```ts
new DrizzleDocumentsRepository(options: DrizzleDocumentsRepositoryOptions<...>)
```

The class is fully generic over your Drizzle condition types (`CKE`, `CKSW`, `CSE`, `CSNE`, `CSI`,
`CDLTE`, `CA`, `RKE`, `RE`, `RA`). TypeScript infers these from the callbacks you pass, so in
practice you never need to name the type parameters explicitly.

### `DrizzleDocumentsRepositoryOptions`

| Field | Type | Description |
|---|---|---|
| `documentQueryBuilders` | `{ keyEquals, keyStartsWith, statusEquals, statusNotEquals, statusIn, depthLte, and }` | Condition factories for the documents table. |
| `revisionQueryBuilders` | `{ keyEquals, revisionEquals, and }` | Condition factories for the revisions table. |
| `callbacks` | `{ documents: DocumentCallbacks, revisions: RevisionCallbacks }` | Async functions that execute each SQL statement. |
| `logger` | `Pick<Console, 'error' \| 'warn' \| 'info' \| 'debug'>` | Optional logger; defaults to no logging. |

### `documentQueryBuilders`

| Field | Signature | Description |
|---|---|---|
| `keyEquals` | `(value: string) => CKE` | Exact match on the `key` column. |
| `keyStartsWith` | `(prefix: string) => CKSW` | Prefix scan on the `key` column (folder listings). |
| `statusEquals` | `(value: string) => CSE` | Match a specific status value (e.g. `"published"`). |
| `statusNotEquals` | `(value: string) => CSNE` | Exclude a specific status value (used to select drafts). |
| `statusIn` | `(values: string[]) => CSI` | Match any of several status values. |
| `depthLte` | `(value: number) => CDLTE` | Upper bound on the `depth` column. |
| `and` | `(...conditions) => CA` | Combines multiple conditions with logical AND. |

### `revisionQueryBuilders`

| Field | Signature | Description |
|---|---|---|
| `keyEquals` | `(value: string) => RKE` | Exact match on the `key` column of the revisions table. |
| `revisionEquals` | `(value: string) => RE` | Match a specific revision identifier. |
| `and` | `(...conditions) => RA` | Combines revision conditions with logical AND. |

### `callbacks.documents`

| Field | Signature | Description |
|---|---|---|
| `insert` | `({ values: DocumentModelStrict }) => Promise<DocumentModel[]>` | Insert a document row; return inserted rows. |
| `update` | `({ where, values: Partial<DocumentModelStrict> }) => Promise<DocumentModel[]>` | Update document rows matching `where`. |
| `delete` | `({ where }) => Promise<DocumentModel[]>` | Delete document rows matching `where`. |
| `select` | `({ where, limit?, offset?, excludeContent? }) => Promise<DocumentModel[]>` | Query documents; skip the `content` column when `excludeContent` is true (used for summary listings). |

### `callbacks.revisions`

| Field | Signature | Description |
|---|---|---|
| `insert` | `({ values: RevisionModelStrict }) => Promise<RevisionModel[]>` | Insert a revision row. |
| `update` | `({ where, values: Partial<RevisionModelStrict> }) => Promise<RevisionModel[]>` | Update revision rows matching `where`. |
| `delete` | `({ where }) => Promise<RevisionModel[]>` | Delete revision rows matching `where`. |
| `select` | `({ where, limit?, excludeContent? }) => Promise<RevisionModel[]>` | Query revisions. |

### Model types

**`DocumentModel`** — shape of a documents table row:

```ts
type DocumentModel = {
  key: string;                   // slash-separated path
  depth: number;                 // number of path segments
  status: string | null | undefined; // e.g. "published", "draft"
  language: string | null | undefined; // BCP 47 language tag
  content: string;               // JSON-serialized StorageObjectContent
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
};
```

**`RevisionModel`** — shape of a revisions table row:

```ts
type RevisionModel = {
  key: string;
  depth: number;
  revision: string;              // revision identifier (e.g. a git SHA or UUID)
  language: string | null | undefined;
  content: string;               // JSON-serialized StorageObjectContent
  createdAt: string;
  updatedAt: string;
};
```

`DocumentModelStrict` and `RevisionModelStrict` are the same shapes with `status`, `language`, and
`revision` required (non-nullable) — used for inserts and strict updates.

## Pagination

Both `offset`/`limit` and page-based (`page`/`perPage`) pagination styles are supported for
`listRecords`, `listRecordSummaries`, and `listRevisions`. Cursor pagination is not supported.

Valid `pagination` shapes:

```ts
{ offset: 0, limit: 50 }     // offset style
{ page: 1, perPage: 50 }     // page style
```

## Behaviour notes

- **Published vs unpublished.** Published records have `status = "published"`. All other status
  values (e.g. `"draft"`) are treated as unpublished. `publish()` and `unpublish()` update the
  `status` column in-place; there is no separate table for drafts.
- **Revisions.** Revisions are stored in a separate table keyed by `(key, revision)`. The revision
  identifier is caller-supplied (any opaque string such as a UUID or git SHA).
- **Depth.** `depth` mirrors the number of slash-separated path segments and is stored at write
  time to enable efficient depth-limited queries without regex filtering.
- **Content serialization.** `StorageObjectContent` is stored as a JSON string; invalid JSON on
  read surfaces as an `InvalidData` error.
- **Summary listings.** `listRecordSummaries` passes `excludeContent: true` to the `select`
  callback so the `content` column can be omitted from the SQL projection, reducing data transfer.
