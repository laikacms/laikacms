---
"@laikacms/airtable": minor
---

New package: `@laikacms/airtable`. First export `@laikacms/airtable/storage-airtable` — a
`StorageRepository` backed by an Airtable table. Reads use `filterByFormula` (Airtable's own DSL
with `{Field}` braces and double-doubled `""` literal escaping). Writes chunk transparently around
Airtable's 10-record batch cap on POST/PATCH/DELETE — `removeAtoms(25)` ships as ⌈25/10⌉ = 3 DELETE
calls. Test suite includes a recursive-descent parser for the filter-formula subset the repository
emits, so any new formula shape surfaces as a parser failure rather than a silent regression.
