# starter-gel-blog

Blog using **[Gel](https://gel.com)** (formerly EdgeDB) as the content store via
`GelStorageRepository` + `createCustomLaika`.

Gel is an object-relational database with EdgeQL — a next-generation query
language where every parameter carries a type and every relationship is a
first-class link. This starter demonstrates three EdgeQL patterns that don't
appear in any other backend in the LaikaCMS suite.

## Quick start

```bash
# 1. Install the Gel CLI — https://docs.geldata.com/cli/installation
curl --proto '=https' --tlsv1.2 -sSf https://sh.geldata.com | sh

# 2. Start a local Gel instance
gel instance create laika-dev --port 5656

# 3. Apply the schema
gel -I laika-dev migration create   # generates the first migration from dbschema/default.esdl
gel -I laika-dev migration apply

# 4. Configure and start
cp .env.example .env
pnpm dev
# http://localhost:3000/admin  ← Decap CMS editor
# http://localhost:3000        ← blog
```

## Schema

The EdgeQL schema lives in `dbschema/default.esdl`:

```edgeql
type LaikaFile {
  required path: str { constraint exclusive };
  required parent: str;
  required name: str;
  required extension: str;
  content: str;
  required createdAt: str;
  required updatedAt: str;
  index on ((.parent, .name));
}

type LaikaFolder {
  required path: str { constraint exclusive };
  required parent: str;
  required name: str;
  required createdAt: str;
  required updatedAt: str;
  index on (.parent);
}
```

The `constraint exclusive` on `path` gives atomic uniqueness — Gel
surfaces `ConstraintViolationError`, which `GelStorageRepository` maps to
`EntryAlreadyExistsError` (same error all other backends return).

## What makes Gel different

Three EdgeQL traits that don't appear in any other LaikaCMS backend:

### 1. `:=` vs `=`
In EdgeQL, `:=` is assignment and `=` is equality:

```edgeql
-- INSERT uses := (assign to property)
INSERT LaikaFile { path := <str>$path, content := <str>$content }

-- SELECT/FILTER uses = (comparison)
SELECT LaikaFile FILTER .path = <str>$path
```

All other backends (libSQL, SurrealDB, PostgreSQL, MongoDB…) use `=` for
both. This means you can't copy-paste SQL snippets into EdgeQL.

### 2. `<type>$param` typed parameter casts
```edgeql
SELECT LaikaFile FILTER .parent = <str>$parent AND .name = <str>$name LIMIT 1
```
Every parameter declares its type inline — `<str>$path`, `<array<str>>$paths`,
`<int64>$limit`. The Gel wire protocol propagates this to the planner.

### 3. `FOR x IN array_unpack(…) UNION (…)` for batch deletes
```edgeql
FOR p IN array_unpack(<array<str>>$paths) UNION (
  DELETE LaikaFile FILTER .path = p
)
```
One statement, one transaction. `removeAtoms(N)` in `GelStorageRepository`
ships all N deletes as a single EdgeQL query — the 15th structurally
distinct atomic-multi-write mechanism in the LaikaCMS backend suite.

## `createCustomLaika` usage

```ts
import { GelDataSource, GelStorageRepository } from '@laikacms/gel/storage-gel';
import { createCustomLaika, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

const dataSource = new GelDataSource({
  url: 'http://localhost:5656',
  branch: 'main',
  auth: { basic: { username: 'gel', password: process.env.GEL_PASSWORD } },
});

const storage = new GelStorageRepository({
  dataSource,
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});

const laika = createCustomLaika({
  storage,
  decapConfig: minimalBlogConfig(),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
```

## Branches

Gel supports multiple branches per instance, similar to git branches. This
is useful for content staging:

```bash
# Create a staging branch
gel branch create staging

# Apply the schema to the staging branch
gel -I laika-dev --branch staging migration apply

# Switch GEL_BRANCH=staging in .env to write to the staging branch
```
