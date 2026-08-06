/**
 * LaikaCMS singleton backed by a GitHub repository.
 *
 * `GithubStorageRepository` writes content to a GitHub repo via the GitHub
 * API, authenticated as a GitHub App. Every save becomes a commit on your
 * content branch — giving you a full audit trail and the ability to deploy
 * from the same repo that powers your CMS.
 *
 * Required environment variables:
 *   GITHUB_APP_ID               — numeric App ID (GitHub App settings page)
 *   GITHUB_APP_PRIVATE_KEY      — PEM private key generated for the app
 *   GITHUB_APP_INSTALLATION_ID  — installation ID (install the app on your repo)
 *   GITHUB_OWNER                — repo owner (org name or username)
 *   GITHUB_REPO                 — repository name
 *   GITHUB_BRANCH               — branch where content is committed (e.g. "main")
 *
 * See .env.example and the GitHub App setup guide in docs/decap-integration.md.
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
import { GithubStorageRepository } from '@laikacms/github/storage-gh';

import { decapConfig } from './decap-config.js';

const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;
const branch = process.env.GITHUB_BRANCH ?? 'main';

if (!appId || !privateKey || !installationId || !owner || !repo) {
  throw new Error(
    'Missing GitHub App credentials. Copy .env.example to .env and fill in '
      + 'GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID, '
      + 'GITHUB_OWNER, and GITHUB_REPO.',
  );
}

const storage = new GithubStorageRepository({
  appId,
  // Private key may be stored with literal \n — expand to real newlines
  privateKey: privateKey.replace(/\\n/g, '\n'),
  installationId,
  owner,
  repo,
  branch,
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    txt: rawSerializer,
  },
  defaultFileExtension: 'md',
  commitAuthor: { name: 'Laika CMS', email: 'cms@laika.local' },
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
    console.log('starter-github-blog: seeded config.yml into GitHub repo');
  } catch (err) {
    console.error('starter-github-blog: failed to seed config.yml', err);
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
