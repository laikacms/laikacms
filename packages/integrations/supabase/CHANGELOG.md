# @laikacms/supabase

## 1.0.0

### Minor Changes

- Initial release. Supabase (PostgREST)-backed `StorageRepository`. Postgres-over-HTTP via the
  auto-generated PostgREST API Supabase exposes on every project. Repository emits PostgREST's
  operator-suffix filter DSL (`?Parent=eq.notes`, `?or=(Name.eq.a,Name.eq.b)`). `removeAtoms(N)`
  ships as a single `Path=in.(…)` DELETE — one round-trip regardless of N. Runtime-agnostic — only
  depends on `fetch`.
