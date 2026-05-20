---
"@laikacms/supabase": minor
---

New package: `@laikacms/supabase`. First export
`@laikacms/supabase/storage-postgrest` — a `StorageRepository` backed by
Supabase's PostgREST endpoint. Postgres-over-HTTP, runs anywhere `fetch`
runs. The repository emits PostgREST's operator-suffix filter DSL
(`?Parent=eq.notes`, `?or=(Name.eq.a,Name.eq.b)`); `removeAtoms(N)` packs
into a single `Path=in.(…)` DELETE regardless of N. Test mock ships a
recursive-descent evaluator for the filter subset the repository emits,
so any new shape surfaces as parser failures instead of silent
regressions. Same data source talks to self-hosted PostgREST too — only
the `apikey` header is Supabase-specific. Runtime-agnostic.
