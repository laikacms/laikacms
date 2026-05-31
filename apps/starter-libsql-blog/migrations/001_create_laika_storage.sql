-- Run this once to create the laika_storage table.
-- Turso: turso db shell <db-name> < migrations/001_create_laika_storage.sql
-- sqld:  curl -s -X POST http://localhost:8080/v2/pipeline \
--          -H "Content-Type: application/json" \
--          -d '{"requests": [{"type": "execute", "stmt": {"sql": "..."}}]}'

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
