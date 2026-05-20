---
"@laikacms/meilisearch": minor
---

New package: `@laikacms/meilisearch`. First export
`@laikacms/meilisearch/storage-meilisearch` — a `StorageRepository`
over a single MeiliSearch index. Five architectural traits
distinguish it from every prior backend including Algolia (iter 11):
(1) **async-by-default mutations via the Tasks API** — every PUT /
DELETE / POST mutation returns `{taskUid, status: 'enqueued'}`; the
data source automatically polls `GET /tasks/{uid}` until terminal
status. **First backend with this async-write-with-polling pattern**;
(2) **`POST /indexes/{uid}/documents/delete-batch`** — bulk delete by
primary-key array, returns ONE task uid; the whole batch commits
atomically once the task succeeds. **The 16th structurally distinct
atomic-multi-write mechanism in the suite** — async-bulk-operation
completed via task polling;
(3) **SQL-like filter syntax** — `parent = "notes" AND type = "file"`
(vs Algolia's Lucene-style `parent:"notes" AND type:"file"`).
`eqFilter` / `andFilter` helpers exported;
(4) **documents have a `primaryKey` declared at index creation**;
the repository configures `id` as primary key with values like
`file:notes/hello.md`;
(5) **search via POST body** — `POST /indexes/{uid}/search` with
`{filter, q, limit}` in JSON body, NOT URL query parameters. Index
auto-created on first use with the right primary key and filterable
attributes. Runtime-agnostic — only depends on `fetch`.
