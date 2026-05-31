-- Run this in Supabase Studio (SQL editor) or psql to provision the content table.
-- Column names use PascalCase (quoted) to match the PostgREST filter parameters
-- emitted by @laikacms/supabase — e.g. ?Parent=eq.posts maps to "Parent".

CREATE TABLE IF NOT EXISTS laika_storage (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  "Parent"   TEXT        NOT NULL DEFAULT '',
  "Name"     TEXT        NOT NULL,
  "Path"     TEXT        NOT NULL,
  "Type"     TEXT        NOT NULL CHECK ("Type" IN ('file', 'folder')),
  "Extension" TEXT,
  "Content"  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT laika_storage_path_unique UNIQUE ("Path")
);

-- Speed up the two most common lookups: children-by-parent and type+parent.
CREATE INDEX IF NOT EXISTS laika_storage_parent_idx ON laika_storage ("Parent");
CREATE INDEX IF NOT EXISTS laika_storage_type_parent_idx ON laika_storage ("Type", "Parent");

-- Optional: enable Row Level Security and allow anon reads for public blogs.
-- ALTER TABLE laika_storage ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "anon read" ON laika_storage FOR SELECT USING (true);
-- CREATE POLICY "service write" ON laika_storage FOR ALL USING (auth.role() = 'service_role');
