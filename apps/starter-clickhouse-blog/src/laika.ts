import { ClickHouseDataSource, ClickHouseStorageRepository } from '@laikacms/clickhouse/storage-clickhouse';
import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';

/**
 * CLICKHOUSE_URL      — ClickHouse HTTP endpoint. Default: http://localhost:8123
 *                       ClickHouse Cloud: https://<host>.clickhouse.cloud:8443
 * CLICKHOUSE_DATABASE — Database name (default: default).
 * CLICKHOUSE_USER     — Username (default: default).
 * CLICKHOUSE_PASSWORD — Password (default: empty).
 *
 * Run sql/migration.sql once before starting:
 *   clickhouse-client --query "$(cat sql/migration.sql)"
 *
 * Quick start (local dev with Docker):
 *   docker run -p 8123:8123 clickhouse/clickhouse-server
 *   pnpm dev   # no auth needed with default Docker setup
 *
 * ClickHouse Cloud:
 *   CLICKHOUSE_URL=https://<host>.clickhouse.cloud:8443 \
 *   CLICKHOUSE_USER=default \
 *   CLICKHOUSE_PASSWORD=<password> \
 *   pnpm dev
 */
const dataSource = new ClickHouseDataSource({
  url: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
  database: process.env['CLICKHOUSE_DATABASE'] ?? 'default',
  auth: {
    headers: {
      username: process.env['CLICKHOUSE_USER'] ?? 'default',
      password: process.env['CLICKHOUSE_PASSWORD'] ?? '',
    },
  },
});

const storage = new ClickHouseStorageRepository({
  dataSource,
  tableName: process.env['CLICKHOUSE_TABLE'] ?? 'laika_storage',
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    raw: rawSerializer,
  },
  defaultFileExtension: 'md',
});

export const laika = createCustomLaika({
  storage,
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export const adminHtml = decapAdminHtml();
