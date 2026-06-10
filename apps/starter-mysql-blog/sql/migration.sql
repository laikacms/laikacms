-- LaikaCMS atoms table for MySQL
-- Run once before starting the app (the app also auto-creates this on boot).
CREATE TABLE IF NOT EXISTS atoms (
  `key`        VARCHAR(255) NOT NULL PRIMARY KEY,
  `type`       VARCHAR(64)  NOT NULL,
  `content`    MEDIUMTEXT   NOT NULL,
  `depth`      INT          NOT NULL,
  `created_at` VARCHAR(64)  NOT NULL,
  `updated_at` VARCHAR(64)  NOT NULL
);

-- MySQL 8.0 does not support CREATE INDEX IF NOT EXISTS;
-- run this manually if the table already exists without the index.
CREATE INDEX atoms_depth_key ON atoms (depth, `key`(255));
