-- LaikaCMS atoms table for PostgreSQL
-- The app also auto-creates this on boot; run manually for pre-existing databases.
CREATE TABLE IF NOT EXISTS atoms (
  key         TEXT PRIMARY KEY NOT NULL,
  type        TEXT NOT NULL,
  content     TEXT NOT NULL,
  depth       INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS atoms_depth_key ON atoms (depth, key);
