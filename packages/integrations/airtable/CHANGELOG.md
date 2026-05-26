# @laikacms/airtable

## 1.0.0

### Minor Changes

- Initial release. Airtable-backed `StorageRepository`. Reads use `filterByFormula` (Airtable's own
  DSL with `{Field}` braces and double-doubled `""`). Writes chunk transparently around Airtable's
  10-record batch cap — `removeAtoms(25)` ships as ⌈25/10⌉ = 3 DELETE calls. Runtime-agnostic — only
  depends on `fetch`.
