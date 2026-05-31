/**
 * Shared factory for Cloudflare Pages Functions.
 *
 * Pages Functions run on the Workers edge runtime — `createEmbeddedLaika`
 * (which requires `node:fs`) is not available.  Wire `decapApi` manually
 * with `R2StorageRepository`, which uses a native R2 bucket binding.
 *
 * This file is imported by both Functions routes; wrangler bundles each
 * Function separately, so each route gets its own module-level cache.
 */
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { collectStream, runTask } from 'laikacms/compat';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import type { RecordSummary } from 'laikacms/documents';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { decapApi } from '@laikacms/decap-integrations/decap-api';

import { decapConfig } from './decap-config.js';

export interface Env {
  /** R2 bucket binding — set up in wrangler.toml [[r2_buckets]]. */
  CONTENT_BUCKET: R2Bucket;
  /** Optional dev bearer token (defaults to 'dev-local-laika-token'). */
  DEV_TOKEN?: string;
}

const serializers = {
  md: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
  txt: rawSerializer,
};

interface LaikaResources {
  api: ReturnType<typeof decapApi>;
  documents: ContentBaseDocumentsRepository;
}

let cached: LaikaResources | null = null;

export async function getLaika(env: Env): Promise<LaikaResources> {
  if (cached) return cached;

  const storage = new R2StorageRepository(
    env.CONTENT_BUCKET,
    serializers,
    'md',
  );

  // Seed config.yml into R2 on first use so DecapContentBaseSettingsProvider
  // can read it back.  Mirrors what createEmbeddedLaika does via ensureConfigOnDisk.
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
  return cached;
}

/** Seed config.yml into R2 if it does not already exist. */
async function ensureConfig(storage: R2StorageRepository): Promise<void> {
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
    console.error('starter-pages-blog: failed to seed config.yml into R2', err);
  }
}

export { collectStream, type RecordSummary, runTask };
