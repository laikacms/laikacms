-- LaikaCMS content storage table for Supabase.
--
-- Run this in the Supabase SQL Editor or via `supabase db push`.
-- The table name must match the `tableName` option in PostgrestStorageRepositoryOptions.
--
-- PostgREST exposes this table at:
--   https://<project-ref>.supabase.co/rest/v1/cms_storage
--
-- RLS is disabled here for simplicity — the server uses the service role key
-- which bypasses RLS. For user-scoped access, enable RLS and add policies.

create table if not exists public.cms_storage (
  id          uuid primary key default gen_random_uuid(),
  parent      text not null,
  name        text not null,
  path        text not null unique,
  type        text not null check (type in ('file', 'folder')),
  extension   text,
  content     text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Index on parent for fast folder listings
create index if not exists cms_storage_parent_idx on public.cms_storage (parent);

-- Auto-update updated_at on row changes
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cms_storage_updated_at on public.cms_storage;
create trigger cms_storage_updated_at
  before update on public.cms_storage
  for each row execute procedure public.set_updated_at();
