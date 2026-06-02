-- LaikaCMS atoms table for D1 / SQLite
-- Run via: wrangler d1 execute laikacms-d1 --local --file migrations/0001_create_atoms.sql
-- Remote: wrangler d1 execute laikacms-d1 --remote --file migrations/0001_create_atoms.sql

CREATE TABLE IF NOT EXISTS atoms (
  key        TEXT    PRIMARY KEY NOT NULL,
  type       TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  depth      INTEGER NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS atoms_depth_key ON atoms (depth, key);
