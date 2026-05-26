# @laikacms/neo4j

[Neo4j](https://neo4j.com/)-backed implementations of Laika CMS contracts. First (and current)
export: **`@laikacms/neo4j/storage-neo4j`** — a `StorageRepository` over the Neo4j transactional
HTTP endpoint.

Runtime-agnostic — only depends on `fetch`. Works against self-hosted Neo4j, Neo4j AuraDB, and any
HTTP-compatible Cypher endpoint.

```bash
pnpm add @laikacms/neo4j
```

## Why a Neo4j package — and what's distinct from SurrealDB

SurrealDB (iter 32) is _graph-capable_; Neo4j is _graph-native_. The wire shape differs in five
concrete ways from every prior backend:

**1. Cypher pattern-matching DSL.** Node patterns use parenthesised labels-and-properties:
`(f:LaikaFile {path: $path})`. Relationships use arrows: `(child)-[:CHILD_OF]->(parent)`. The arrow
direction matters; it's part of the pattern grammar.

**2. Graph relationships as the hierarchy primitive.** The repository links each file/folder node to
its parent via a `[:CHILD_OF]` relationship. Folder listings are pattern-match traversals:

```cypher
MATCH (p:LaikaFolder {path: $parent})<-[:CHILD_OF]-(c)
RETURN c
```

The `<-[:CHILD_OF]-` arrow flips direction — finding incoming edges. First backend in the suite to
use graph traversal as a listing primitive.

**3. `DETACH DELETE`.** `MATCH (f:LaikaFile {path: $path}) DETACH
DELETE f` removes the node AND
every relationship attached to it. **First cascading-delete primitive in the suite.**

**4. `POST /db/{db}/tx/commit` with `{statements: [...]}` — implicit transaction boundary at the
endpoint.** Every body is one transaction; multi-statement batches are atomic by construction.
Unlike SurrealDB (`BEGIN TRANSACTION; …; COMMIT TRANSACTION;` keywords in the query text), Neo4j's
atomicity is endpoint-shape-driven. **The 14th structurally distinct atomic-multi-write mechanism in
the suite.**

**5. Node label discrimination.** `:LaikaFile` and `:LaikaFolder` are labels — first-class type tags
on the node itself. A single node can carry multiple labels; pattern matching against any of them
works. Unlike a `type: 'file'` property field, labels are indexed and participate in the pattern
grammar.

## Usage

```ts
import { Neo4jDataSource, Neo4jStorageRepository } from '@laikacms/neo4j/storage-neo4j';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new Neo4jDataSource({
  url: 'http://neo4j.example.com:7474',
  database: 'cms',
  auth: { basic: { username: 'neo4j', password: process.env.NEO4J_PASSWORD! } },
});

const repo = new Neo4jStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Schema setup

Neo4j is schema-less for nodes/relationships, but indexes help. The repository assumes (but does not
create) the following:

```cypher
CREATE INDEX laika_file_lookup IF NOT EXISTS
  FOR (f:LaikaFile) ON (f.parent, f.name);
CREATE INDEX laika_file_path IF NOT EXISTS
  FOR (f:LaikaFile) ON (f.path);
CREATE INDEX laika_folder_path IF NOT EXISTS
  FOR (f:LaikaFolder) ON (f.path);

// Optional: enforce path uniqueness as a constraint.
CREATE CONSTRAINT laika_file_path_unique IF NOT EXISTS
  FOR (f:LaikaFile) REQUIRE f.path IS UNIQUE;
CREATE CONSTRAINT laika_folder_path_unique IF NOT EXISTS
  FOR (f:LaikaFolder) REQUIRE f.path IS UNIQUE;
```

The `UNIQUE` constraint is what makes Neo4j surface `ConstraintValidationFailed` on duplicate-key
creates — the data source maps that to `EntryAlreadyExistsError`.

## Graph model

```
(notes/hello.md :LaikaFile)
  ├─ path: "notes/hello.md"
  ├─ parent: "notes"
  ├─ name: "hello"
  ├─ extension: "md"
  ├─ content: "..."
  └─ createdAt/updatedAt

  ─[:CHILD_OF]─►

(notes :LaikaFolder)
  ├─ path: "notes"
  ├─ name: "notes"
  └─ createdAt/updatedAt
```

Root-level entries have no `[:CHILD_OF]` outgoing edge. The `collectFilteredSummaries` query uses
`NOT (c)-[:CHILD_OF]->()` to find them.

## Operation mapping

| Laika operation             | Cypher                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `getObject(key)`            | `MATCH (f:LaikaFile {parent, name}) RETURN f LIMIT 1`                                                                    |
| `createObject(key, …)`      | 1 × probe MATCH + 1 × `tx/commit` with `CREATE (f:LaikaFile …)` + `MERGE (p:LaikaFolder)` + `MERGE (f)-[:CHILD_OF]->(p)` |
| `updateObject(key, …)`      | 1 × probe + 1 × `MATCH (f) SET f.content = $content`                                                                     |
| `createOrUpdateObject`      | 1 × probe + 1 × (`CREATE` or `SET`)                                                                                      |
| `createFolder(key)`         | 1 × `tx/commit` with `MERGE (f:LaikaFolder)` + parent linkage                                                            |
| `removeAtoms([k₁…kₙ])`      | n × probe MATCH + **1 × `tx/commit` with N `DETACH DELETE` statements**                                                  |
| `listAtomSummaries(folder)` | 1 × incoming-edge MATCH (`<-[:CHILD_OF]-`)                                                                               |
| `getCapabilities()`         | (no I/O — static)                                                                                                        |

## Cypher injection guard

Node labels and relationship types in Cypher are NOT parameterisable — they're part of the query
grammar, not value positions. So we can't safely interpolate them via `$param`. The repository
validates configured labels against a strict regex:

- Labels: `^[A-Z][A-Za-z0-9_]*$` (PascalCase identifier)
- Relationship types: `^[A-Z][A-Z0-9_]*$` (UPPER_SNAKE_CASE)

Any value outside this charset throws at construction time. Verified by the "label validation
rejects unsafe Cypher labels" test.

## Auth

```ts
new Neo4jDataSource({
  url, database,
  auth: {
    basic: { username, password },        // typical self-hosted
    bearer: 'auradb_token',               // Neo4j AuraDB / SSO
    headerProvider: async () => ({ ... }),// custom auth flow
  },
});
```

For unauthenticated dev clusters (port 7687 open with `dbms.security.auth_enabled=false`), omit
`auth` entirely.

## Caveats

- **Bolt is not supported.** This package speaks the HTTP transactional endpoint only
  (`/db/{db}/tx/commit`). Bolt — Neo4j's native binary protocol — needs the official `neo4j-driver`
  client. The HTTP shape works in edge runtimes (Workers, browsers) where Bolt doesn't.
- **No streaming queries.** Long-running Cypher that streams results via Bolt's `RUN` + `PULL`
  doesn't translate to the HTTP shape; every `tx/commit` returns the full result set in one response
  body.
- **Per-node `elementId()` not exposed.** Neo4j has an internal node identity (`elementId(n)`) but
  it's per-instance and changes across restores. `revisionId` uses `<label>:<path>` — stable across
  backups and restores.
