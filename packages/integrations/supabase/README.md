# `@laikacms/supabase`

A Supabase (PostgREST)-backed `StorageRepository` for Laika CMS. Postgres-over-HTTP via the
[PostgREST API](https://docs.postgrest.org/en/stable/) that Supabase exposes on every project — no
driver, no connection pool, runs everywhere `fetch` runs.

The same data source talks to **self-hosted PostgREST** too; the only Supabase-specific knob is the
`apikey` header.

## `@laikacms/supabase/storage-postgrest`

```ts
import { PostgrestStorageRepository } from '@laikacms/supabase/storage-postgrest';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const repo = new PostgrestStorageRepository({
  url: process.env.SUPABASE_URL! + '/rest/v1', // <project>.supabase.co/rest/v1
  tableName: 'laika_storage',
  auth: { anonKey: process.env.SUPABASE_ANON_KEY! },
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});
```

### Required table schema

Provision once via Supabase Studio (Table Editor) or `psql`:

```sql
create table laika_storage (
  id uuid primary key default gen_random_uuid(),
  "Parent"     text not null,
  "Name"       text not null,
  "Path"       text not null unique,
  "Type"       text not null check ("Type" in ('file','folder')),
  "Extension"  text,
  "Content"    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index laika_storage_parent_idx on laika_storage ("Parent");
```

Field names are capitalised because the repository emits them that way in PostgREST filter URLs —
quote them in your DDL so Postgres preserves the case.

### The PostgREST DSL

Every backend in the loop has used a different filter language; **PostgREST's operator-suffix
style** is yet another:

| Shape                                    | URL                               |
| ---------------------------------------- | --------------------------------- |
| `Parent === 'notes'`                     | `?Parent=eq.notes`                |
| `Type === 'file' AND Parent === 'notes'` | `?Type=eq.file&Parent=eq.notes`   |
| `Name IN ('a.md','b.md','c.md')`         | `?Name=in.("a.md","b.md","c.md")` |
| `Name = 'a' OR Name = 'b'`               | `?or=(Name.eq.a,Name.eq.b)`       |

The repository builds these for the exact shapes Laika storage needs. Notable:

- **Find by extension-free key** uses an `or=(…)` group of `Name.eq.<key>.<ext>` clauses — one
  request resolves every registered extension.
- **`removeAtoms(N keys)`** packs every resolved path into one `Path=in.(…)` DELETE — single
  round-trip regardless of N.

The "removeAtoms uses one IN-list DELETE" test wraps `fetch` in a counter and asserts exactly one
DELETE call fires for `removeAtoms(['a', 'b', 'c'])`.

### Auth model

Supabase wraps PostgREST behind two parallel auth headers:

- `apikey: <anon_or_service_key>` — required on every request, identifies the project + role.
- `Authorization: Bearer <jwt>` — when present, replaces the anon key. Used to scope reads/writes to
  a user via [Row-Level Security](https://supabase.com/docs/guides/auth/row-level-security).

The data source supports both: `auth.anonKey` populates `apikey` and the default Bearer;
`auth.userJwt` overrides just the Bearer.

### How operations map

| Operation                    | PostgREST call                                                  |
| ---------------------------- | --------------------------------------------------------------- |
| `getObject('hello')`         | one GET with `or=(Name.eq.hello.md, …)` for the extension probe |
| `getFolder('notes')`         | one GET with `?Type=eq.folder&Path=eq.notes`                    |
| `listAtomSummaries('notes')` | one GET with `?Parent=eq.notes`                                 |
| `createObject`               | one POST per file + one per missing ancestor folder             |
| `updateObject`               | one PATCH with `?Path=eq.<key>`                                 |
| `removeAtoms(N keys)`        | resolution + **one** DELETE with `?Path=in.(…)`                 |

### Trade-offs

- **You provision the table.** Same as Cloudflare D1 / PocketBase / Airtable — the repository never
  runs DDL.
- **RLS is your job.** Supabase enforces row-level security based on the JWT in `Authorization`. The
  repository doesn't reason about RLS rules; if your policies refuse a write, you get a
  `ForbiddenError`.
- **Connection limits don't apply.** PostgREST is stateless HTTP; you can call this from any edge
  runtime without worrying about pgbouncer's pool size.
- **`metadata.revisionId`** is the row's `updated_at` timestamp. Not enforced for OCC.

### Errors

| HTTP | Laika error                            |
| ---- | -------------------------------------- |
| 401  | `AuthenticationError`                  |
| 403  | `ForbiddenError` (RLS or grant denial) |
| 404  | `NotFoundError`                        |
| 429  | `TooManyRequestsError`                 |
| 5xx  | `ServiceUnavailableError`              |
