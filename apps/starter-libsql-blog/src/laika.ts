/**
 * LaikaCMS singleton backed by Turso / libSQL.
 *
 * `LibSqlStorageRepository` speaks the libSQL Hrana HTTP pipeline protocol
 * (`POST /v2/pipeline`) over `fetch`. It works with Turso (managed libSQL),
 * local sqld, or any server that speaks the same wire protocol.
 *
 * **Schema**: run `migrations/001_create_laika_storage.sql` once before
 * starting the app. The starter does this automatically on first run via
 * `ensureSchema()` — the `CREATE TABLE IF NOT EXISTS` statement is idempotent.
 *
 * Required environment variables:
 *   LIBSQL_URL        — https://<db>.turso.io or http://localhost:8080
 *   LIBSQL_AUTH_TOKEN — JWT from Turso dashboard; leave empty for local sqld
 *
 * See .env.example and https://turso.tech/ for setup instructions.
 */
import * as Result from 'effect/Result';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { runTask } from 'laikacms/compat';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { decapApi } from '@laikacms/decap-integrations/decap-api';
import { DEFAULT_DEV_TOKEN } from '@laikacms/decap-integrations/embedded';
import { LibSqlDataSource, LibSqlStorageRepository } from '@laikacms/libsql/storage-libsql';

import { decapConfig } from './decap-config.js';

const libsqlUrl = process.env.LIBSQL_URL;
const authToken = process.env.LIBSQL_AUTH_TOKEN;

if (!libsqlUrl) {
  throw new Error(
    'Missing LIBSQL_URL env var. Copy .env.example to .env and fill in your Turso database URL.',
  );
}

const dataSource = new LibSqlDataSource({
  url: libsqlUrl,
  auth: authToken ? { token: authToken } : undefined,
});

async function ensureSchema(): Promise<void> {
  const r1 = await dataSource.execute(
    `CREATE TABLE IF NOT EXISTS laika_storage (
      Path      TEXT PRIMARY KEY,
      Parent    TEXT NOT NULL,
      Name      TEXT NOT NULL,
      Type      TEXT NOT NULL CHECK (Type IN ('file', 'folder')),
      Extension TEXT,
      Content   TEXT,
      UNIQUE (Type, Parent, Name)
    )`,
  );
  if (Result.isFailure(r1)) {
    console.error('starter-libsql-blog: failed to create laika_storage table', r1.failure);
    return;
  }
  await dataSource.execute(
    'CREATE INDEX IF NOT EXISTS laika_storage_parent_idx ON laika_storage (Parent)',
  );
}

await ensureSchema();

const storage = new LibSqlStorageRepository({
  dataSource,
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    txt: rawSerializer,
  },
  defaultFileExtension: 'md',
});

async function ensureConfig(): Promise<void> {
  try {
    await runTask(storage.getObject('config.yml'));
    return;
  } catch {
    // Not found — seed it
  }
  try {
    await runTask(
      storage.createOrUpdateObject({
        key: 'config.yml',
        type: 'object',
        content: decapConfig as Record<string, unknown>,
      }),
    );
    console.log('starter-libsql-blog: seeded config.yml into libSQL');
  } catch (err) {
    console.error('starter-libsql-blog: failed to seed config.yml', err);
  }
}

await ensureConfig();

const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
const documents = new ContentBaseDocumentsRepository(storage, settings);
const assets = new ContentBaseAssetsRepository(storage, settings);

const api = decapApi({
  documents,
  storage,
  assets,
  basePath: '/api/decap',
  authenticateAccessToken: async (token: string) => {
    if (token !== DEFAULT_DEV_TOKEN) throw new Error('Unauthorized');
    return { id: 'dev', email: 'dev@local.test', name: 'Dev Editor' };
  },
});

export const laika = {
  documents,
  fetch: (request: Request) => api.fetch(request),
};
