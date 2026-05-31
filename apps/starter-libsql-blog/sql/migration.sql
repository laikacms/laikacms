-- Run this once against your Turso / libSQL database before starting the app.
--
--   turso db shell <your-db> < sql/migration.sql
--   # or paste into any SQL console connected to your libSQL instance
--
-- The table uses PascalCase columns to match the internal wire format.

CREATE TABLE IF NOT EXISTS laika_storage (
  Path      TEXT PRIMARY KEY,
  Parent    TEXT NOT NULL,
  Name      TEXT NOT NULL,
  Type      TEXT NOT NULL CHECK (Type IN ('file', 'folder')),
  Extension TEXT,
  Content   TEXT,
  UNIQUE (Type, Parent, Name)
);

CREATE INDEX IF NOT EXISTS laika_storage_parent_idx ON laika_storage (Parent);
