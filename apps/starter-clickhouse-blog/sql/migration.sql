-- Run this once against your ClickHouse database before starting the app.
--
--   clickhouse-client --query "$(cat sql/migration.sql)"
--   # or paste into the ClickHouse Cloud UI SQL editor
--
-- ReplacingMergeTree deduplicates rows on background merges, keeping the
-- row with the highest `version` per (type, parent, name). Queries use
-- FINAL to force a merge-on-read for consistent results.

CREATE TABLE IF NOT EXISTS laika_storage (
  path       String,
  parent     String,
  name       String,
  type       LowCardinality(String),
  extension  String DEFAULT '',
  content    String DEFAULT '',
  version    UInt64 DEFAULT toUnixTimestamp64Milli(now64()),
  createdAt  String DEFAULT toString(now64()),
  updatedAt  String DEFAULT toString(now64())
) ENGINE = ReplacingMergeTree(version)
PRIMARY KEY (type, parent, name)
ORDER BY (type, parent, name);
