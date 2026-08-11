# SQL (Drizzle)

`DrizzleStorageRepository` backs the [Storage protocol](../concepts/storage) with any SQL database
via [Drizzle ORM](https://orm.drizzle.team/) — tested with SQLite (`better-sqlite3` and Cloudflare
D1), PostgreSQL, and MySQL. `documents-drizzle` does the same for the
[Documents protocol](../concepts/documents), for natively document-shaped tables.

The repository is database-agnostic: you supply query-builder callbacks for your dialect and it
handles the storage contract.

## Wire it up

```ts
import { and, count, eq, like, lte } from 'drizzle-orm';
import { DrizzleStorageRepository } from 'laikacms/storage-drizzle';

import { db, storageTable } from './db'; // your Drizzle db instance and table

const storage = new DrizzleStorageRepository({
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
    // optional — enables correct meta.total for paginated responses
    count: ({ where }) =>
      db.select({ count: count() }).from(storageTable).where(where).then(([r]) => r?.count ?? 0),
  },
});
```

## Capability notes

- Because _you_ own the Drizzle instance, this works on every runtime Drizzle supports — including
  Cloudflare D1 at the edge (see [`starter-workers-blog`](../getting-started/starters)).
- Mixing backends is normal: back hot, queryable collections with SQL while the rest stays in git or
  on disk, behind one routing repository
  ([Architecture → repository pattern](../concepts/architecture#the-repository-pattern)).
- Full options and schema guidance:
  [`storage-drizzle` README](https://github.com/laikacms/laikacms/blob/develop/packages/laikacms/src/impl/storage-drizzle/README.md).
