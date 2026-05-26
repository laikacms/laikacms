---
"@laikacms/neo4j": minor
---

New package: `@laikacms/neo4j`. First export `@laikacms/neo4j/storage-neo4j` — a `StorageRepository`
backed by [Neo4j](https://neo4j.com/) via the transactional HTTP endpoint
(`POST /db/{db}/tx/commit`). Works against self-hosted Neo4j, AuraDB, and any HTTP-compatible Cypher
endpoint. Five architectural traits distinguish it from every prior backend — including SurrealDB
(which is graph-capable but not graph-native): (1) **Cypher pattern-matching DSL** —
`(f:LaikaFile)`, `(child)-[:CHILD_OF]->(parent)` syntax with arrow-direction semantics; (2) **graph
relationships as the hierarchy primitive** — files link to folders via `[:CHILD_OF]` edges, and
folder listings are pattern- match traversals (`<-[:CHILD_OF]-(c)`). **First backend using graph
traversal as a listing primitive**; (3) **`DETACH DELETE`** — first cascading-delete primitive in
the suite. Removes node + all relationships in one statement; (4) **`POST /tx/commit` with
`{statements: [...]}`** — implicit transaction boundary at the endpoint, no `BEGIN`/`COMMIT`
keywords. `removeAtoms(N)` ships as one tx/commit body with N DETACH DELETE statements. **The 14th
structurally distinct atomic-multi-write mechanism in the suite**; (5) **node label discrimination**
— `:LaikaFile` / `:LaikaFolder` as first-class label tags, not `type` properties. Plus Cypher
injection guards on configured labels (PascalCase) and relationship types (UPPER_SNAKE_CASE) since
labels aren't parameterisable in Cypher. Runtime-agnostic — only depends on `fetch`.
