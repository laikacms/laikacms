/**
 * LaikaCMS singleton backed by Upstash Redis.
 *
 * `UpstashRedisStorageRepository` talks the Upstash REST API over `fetch` —
 * the same code runs in Node.js, Cloudflare Workers, Vercel Edge Functions,
 * Deno Deploy, and any other runtime with a global `fetch`.
 *
 * Required environment variables:
 *   UPSTASH_REDIS_URL    — https://<region>-<name>-<n>.upstash.io
 *   UPSTASH_REDIS_TOKEN  — REST token from Upstash console
 *
 * Create a free Redis database at https://console.upstash.com/ and copy
 * the REST URL + token to .env (see .env.example).
 */
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
import { UpstashRedisStorageRepository } from '@laikacms/upstash/storage-redis';

import { decapConfig } from './decap-config.js';

const redisUrl = process.env.UPSTASH_REDIS_URL;
const redisToken = process.env.UPSTASH_REDIS_TOKEN;

if (!redisUrl || !redisToken) {
  throw new Error(
    'Missing UPSTASH_REDIS_URL or UPSTASH_REDIS_TOKEN env vars. '
      + 'Copy .env.example to .env and fill in your Upstash credentials.',
  );
}

const storage = new UpstashRedisStorageRepository({
  url: redisUrl,
  token: redisToken,
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    txt: rawSerializer,
  },
  defaultFileExtension: 'md',
  // keyPrefix defaults to 'laika:storage' — override per-tenant for multi-tenant setups
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
    console.log('starter-upstash-blog: seeded config.yml into Upstash Redis');
  } catch (err) {
    console.error('starter-upstash-blog: failed to seed config.yml', err);
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
