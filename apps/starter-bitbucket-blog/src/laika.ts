import { BitbucketStorageRepository } from '@laikacms/bitbucket/storage-bb';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * BITBUCKET_WORKSPACE  — Bitbucket workspace slug (required).
 * BITBUCKET_REPO       — Repository slug (required).
 * BITBUCKET_BRANCH     — Branch to read/write (default: main).
 *
 * Auth — one of:
 *   BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD  — HTTP Basic with an app password.
 *   BITBUCKET_OAUTH_TOKEN                        — OAuth 2.0 Bearer token.
 *
 * BITBUCKET_AUTHOR_NAME  — Commit author display name (default: Laika Bot).
 * BITBUCKET_AUTHOR_EMAIL — Commit author email (default: bot@example.com).
 *
 * Key Bitbucket trait: all writes (create, update, delete) go through a single
 * POST /repositories/{ws}/{repo}/src endpoint with a multipart body — one HTTP
 * round-trip per commit. Multiple files change in one atomic commit.
 *
 * Quick start (app password):
 *   Create an app password at https://bitbucket.org/account/settings/app-passwords/
 *   with Repository: read + write permissions.
 *   BITBUCKET_WORKSPACE=myws BITBUCKET_REPO=content \
 *   BITBUCKET_USERNAME=alice BITBUCKET_APP_PASSWORD=<pw> pnpm dev
 *
 * Quick start (OAuth):
 *   BITBUCKET_WORKSPACE=myws BITBUCKET_REPO=content \
 *   BITBUCKET_OAUTH_TOKEN=<token> pnpm dev
 */

const oauthToken = process.env['BITBUCKET_OAUTH_TOKEN'];
const username = process.env['BITBUCKET_USERNAME'];
const appPassword = process.env['BITBUCKET_APP_PASSWORD'];

const auth = oauthToken
  ? { oauthToken }
  : {
    appPassword: {
      username: username ?? requireEnv('BITBUCKET_USERNAME'),
      password: appPassword ?? requireEnv('BITBUCKET_APP_PASSWORD'),
    },
  };

const storage = new BitbucketStorageRepository({
  workspace: requireEnv('BITBUCKET_WORKSPACE'),
  repo: requireEnv('BITBUCKET_REPO'),
  branch: process.env['BITBUCKET_BRANCH'] ?? 'main',
  auth,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
  commitAuthor: {
    name: process.env['BITBUCKET_AUTHOR_NAME'] ?? 'Laika Bot',
    email: process.env['BITBUCKET_AUTHOR_EMAIL'] ?? 'bot@example.com',
  },
});

export const decapConfig = minimalBlogConfig();

export const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export { decapAdminHtml };
