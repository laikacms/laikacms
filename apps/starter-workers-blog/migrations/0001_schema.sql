-- LaikaCMS storage table for Cloudflare D1
-- Run with: wrangler d1 migrations apply starter-workers-blog-db
--
-- The schema is generated from schemaDdl() in @laikacms/cloudflare/storage-d1.
-- If you change the table name in D1StorageRepository options, update this file too.

CREATE TABLE IF NOT EXISTS "laika_storage" (
  parent_key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('file', 'folder')),
  extension TEXT,
  content TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  etag TEXT NOT NULL,
  PRIMARY KEY (parent_key, name)
);
