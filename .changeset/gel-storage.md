---
"@laikacms/gel": minor
---

New package: `@laikacms/gel`. First export
`@laikacms/gel/storage-gel` — a `StorageRepository` backed by Gel
(formerly EdgeDB) via the HTTP EdgeQL endpoint. Five architectural
traits distinguish it from every prior backend in the suite:
(1) **EdgeQL object-shape literals** — `INSERT LaikaFile { path :=
<str>$path }` (note `:=` for assignment, `=` for equality);
(2) **`<type>$param` typed parameter casts** — every parameter
declares its type in the query text itself (`<str>$path`,
`<array<str>>$paths`), propagating to the backend planner;
(3) **`FOR x IN ... UNION ( ... )` for atomic batching** —
`removeAtoms(N)` ships as ONE `FOR p IN array_unpack(<array<str>>$paths)
UNION (DELETE LaikaFile FILTER .path = p)` query — single statement,
one transaction. **The 15th structurally distinct atomic-multi-write
mechanism in the suite**;
(4) **`UNLESS CONFLICT ON .property ELSE ( ... )`** — EdgeQL's
UPSERT-with-fallback idiom, distinct from MERGE (Cypher/SurrealDB),
ON CONFLICT (libSQL), and CAS-based mechanisms;
(5) **object types with links** — schema-first object-relational
model; first object-relational backend in the suite. Type and
module identifiers (which EdgeQL can't parameterise) are validated
against a strict regex to prevent injection. Runtime-agnostic —
only depends on `fetch`.
