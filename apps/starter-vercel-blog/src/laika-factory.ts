/**
 * Shared Laika factory for Vercel Edge Functions.
 *
 * Vercel Edge Functions run on the V8 edge runtime — `createEmbeddedLaika`
 * (which hardcodes `FileSystemStorageRepository`) is not available.  Wire
 * `decapApi` manually with `VercelBlobStorageRepository` instead.
 *
 * Vercel Blob is accessed over HTTP using `BLOB_READ_WRITE_TOKEN`.  Unlike
 * R2 (native binding) or D1 (REST API via explicit secrets), Vercel Blob only
 * needs a single token env var.  The same token works in local `vercel dev`
 * and in production — there is no local mock.  Create a Blob store in the
 * Vercel dashboard (Storage → Create → Blob) and copy the token to `.env`.
 */
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { collectStream, runTask } from 'laikacms/compat';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import type { RecordSummary } from 'laikacms/documents';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { decapApi } from '@laikacms/decap-integrations/decap-api';
import { VercelBlobDataSource, VercelBlobStorageRepository } from '@laikacms/vercel/storage-blob';

import { decapConfig } from './decap-config.js';

interface LaikaResources {
  api: ReturnType<typeof decapApi>;
  documents: ContentBaseDocumentsRepository;
}

const serializers = {
  md: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
  txt: rawSerializer,
};

let cached: LaikaResources | null = null;
let cachedToken = '';

export async function getLaika(env: { BLOB_READ_WRITE_TOKEN?: string, DEV_TOKEN?: string }): Promise<LaikaResources> {
  const blobToken = env.BLOB_READ_WRITE_TOKEN ?? '';

  if (cached && cachedToken === blobToken) return cached;

  const dataSource = new VercelBlobDataSource({ auth: { token: blobToken } });
  const storage = new VercelBlobStorageRepository({
    dataSource,
    serializerRegistry: serializers,
    defaultFileExtension: 'md',
  });

  await ensureConfig(storage);

  const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
  const documents = new ContentBaseDocumentsRepository(storage, settings);
  const assets = new ContentBaseAssetsRepository(storage, settings);

  const devToken = env.DEV_TOKEN ?? 'dev-local-laika-token';

  const api = decapApi({
    documents,
    storage,
    assets,
    basePath: '/api/decap',
    authenticateAccessToken: async (token: string) => {
      if (token !== devToken) throw new Error('Unauthorized');
      return { id: 'dev', email: 'dev@local.test', name: 'Dev Editor' };
    },
  });

  cached = { api, documents };
  cachedToken = blobToken;
  return cached;
}

async function ensureConfig(storage: VercelBlobStorageRepository): Promise<void> {
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
  } catch (err) {
    console.error('starter-vercel-blog: failed to seed config.yml into Vercel Blob', err);
  }
}

export { collectStream, type RecordSummary, runTask };
