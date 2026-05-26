# @laikacms/gel

[Gel](https://gel.com) (formerly [EdgeDB](https://edgedb.com))-backed implementations of Laika CMS
contracts. First (and current) export: **`@laikacms/gel/storage-gel`** — a `StorageRepository` over
the Gel HTTP EdgeQL endpoint.

Runtime-agnostic — only depends on `fetch`.

```bash
pnpm add @laikacms/gel
```

## Why a Gel package

Gel is an object-relational database — first-class object types with links, schema-first migrations,
and EdgeQL as its query language. Five architectural traits set it apart from every prior backend in
the Laika suite:

**1. EdgeQL object-shape literals.** Both writes and reads use a shape grammar where `:=` assigns
and `=` compares:

```edgeql
INSERT LaikaFile {
  path := <str>$path,
  parent := <str>$parent,
  content := <str>$content
}

SELECT LaikaFile { id, path, parent, content }
FILTER .parent = <str>$parent AND .name = <str>$name
LIMIT 1
```

The `:=` (assign) vs `=` (equality) distinction is part of the language grammar — first backend in
the suite with this distinction at the wire level.

**2. `<type>$param` typed parameter casts.** Every parameter declares its type in the query text
itself: `<str>$path`, `<array<str>>$paths`, `<int64>$limit`. This propagates to the backend planner
— different from any prior parameter syntax (libSQL's typed-object wire format, SurrealDB's `$name`,
PostgreSQL's `$1`).

**3. `FOR x IN ... UNION ( query x )` for atomic batching.** Set comprehensions iterate a parameter
array, running the same query against each element. Single statement; one transaction.

```edgeql
FOR p IN array_unpack(<array<str>>$paths) UNION (
  DELETE LaikaFile FILTER .path = p
)
```

`removeAtoms(N)` ships as ONE such query. **The 15th structurally distinct atomic-multi-write
mechanism in the Laika suite.**

**4. `UNLESS CONFLICT ON .property ELSE ( ... )`.** EdgeQL's UPSERT-with-fallback idiom. Different
from MERGE (Cypher / SurrealDB), ON CONFLICT (libSQL / Postgres), and putRecord+swapRecord (AT
Protocol). The ELSE branch runs as the alternate action — typically an UPDATE — when the conflict
fires.

**5. Object types with links.** Schema-first object-relational model: foreign keys are replaced with
`link` properties that return sets. First object-relational backend in the suite.

## Usage

```ts
import { GelDataSource, GelStorageRepository } from '@laikacms/gel/storage-gel';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new GelDataSource({
  url: 'http://gel.example.com:5656',
  branch: 'main',
  auth: { basic: { username: 'admin', password: process.env.GEL_PASSWORD! } },
});

const repo = new GelStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Schema setup

Gel is schema-first. Provision once via `gel migration create` or the UI:

```edgeql
module default {
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
}
```

The `constraint exclusive` on `path` is what makes Gel surface `ConstraintViolationError` on
duplicate-key creates — the data source maps that to `EntryAlreadyExistsError`.

## Operation mapping

| Laika operation             | EdgeQL                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `getObject(key)`            | `SELECT LaikaFile { … } FILTER .parent = <str>$parent AND .name = <str>$name LIMIT 1`                              |
| `createObject(key, …)`      | 1 × probe SELECT + 1 × `INSERT LaikaFile { path := <str>$path, … }`                                                |
| `updateObject(key, …)`      | 1 × probe + 1 × `UPDATE LaikaFile FILTER .path = <str>$path SET { content := <str>$content }`                      |
| `createOrUpdateObject`      | 1 × probe + 1 × `INSERT … UNLESS CONFLICT ON .path ELSE ( UPDATE … )`                                              |
| `createFolder(key)`         | 1 × `INSERT LaikaFolder { … } UNLESS CONFLICT ON .path`                                                            |
| `removeAtoms([k₁…kₙ])`      | n × probe SELECT + **1 × `FOR p IN array_unpack(<array<str>>$paths) UNION ( DELETE LaikaFile FILTER .path = p )`** |
| `listAtomSummaries(folder)` | 2 × `SELECT … FILTER .parent = <str>$parent` (one per type)                                                        |
| `getCapabilities()`         | (no I/O — static)                                                                                                  |

## Module qualification

EdgeQL types live in modules — `default::LaikaFile` is the canonical qualified name. To use a
non-default module:

```ts
new GelStorageRepository({
  dataSource,
  moduleName: 'cms', // → cms::LaikaFile, cms::LaikaFolder
  // …
});
```

The module name is validated against `^[A-Za-z_][A-Za-z0-9_]*$` to prevent EdgeQL injection (the
module qualifier is interpolated, not parameterised — there's no `<module>$param` cast in EdgeQL).

## Auth

```ts
new GelDataSource({
  url, branch,
  auth: {
    basic: { username, password },        // typical self-hosted
    bearer: 'gel_cloud_jwt',              // Gel Cloud / SSO
    headerProvider: async () => ({ ... }),// custom auth flow
  },
});
```

## Caveats

- **Bolt-style binary protocol is not supported.** This package speaks the HTTP EdgeQL endpoint
  only. The official `gel` / `edgedb-js` client uses a binary protocol with better latency; for
  production HTTP works fine for CMS workloads.
- **Schema migrations are out of scope.** Provision tables and indexes via `gel migration create` /
  `gel migrate`. The repository never runs DDL.
- **Type and module identifiers are interpolated, not parameterised.** EdgeQL doesn't allow
  `<type>$name` for type _names_ (only for value casts). The repository validates configured
  identifiers against a strict regex to prevent injection.
- **Gel ↔ EdgeDB naming.** The product rebranded from EdgeDB to Gel in October 2024. The wire
  protocol and EdgeQL syntax are identical; only the CLI (`gel` instead of `edgedb`) and the company
  name changed. This package targets the protocol, so works with either product version.
