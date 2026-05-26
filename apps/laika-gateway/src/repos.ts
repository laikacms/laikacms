import { GithubStorageRepository } from '@laikacms/github/storage-gh';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import type { Env } from './env.js';

export interface Tenant {
  readonly owner: string;
  readonly repo: string;
  /** Branch the Decap CMS frontend writes to. Defaults to `main`. */
  readonly branch?: string;
}

export interface Repos {
  readonly storage: GithubStorageRepository;
  readonly documents: ContentBaseDocumentsRepository;
  readonly assets: ContentBaseAssetsRepository;
  readonly settingsProvider: DecapContentBaseSettingsProvider;
}

/** Cached resolution of `(owner/repo)` to its GitHub App installation id. */
const installationIdCache = new WeakMap<Env, Map<string, number>>();
/** Cached per-tenant repo bundle. WeakMap on env lets the cache evict per isolate. */
const reposCache = new WeakMap<Env, Map<string, Repos>>();

const tenantKey = (t: Tenant) => `${t.owner}/${t.repo}@${t.branch ?? 'main'}`;

const normalizePrivateKey = (raw: string): string => raw.replace(/\\n/g, '\n').replace(/^"+|"+$/g, '');

/**
 * Resolve the App's installation id for `owner/repo`. Cached per worker
 * isolate so we make at most one App-level API call per tenant per cold start.
 */
const resolveInstallationId = async (
  env: Env,
  owner: string,
  repo: string,
): Promise<number> => {
  let perEnv = installationIdCache.get(env);
  if (!perEnv) {
    perEnv = new Map();
    installationIdCache.set(env, perEnv);
  }
  const key = `${owner}/${repo}`;
  const cached = perEnv.get(key);
  if (cached !== undefined) return cached;

  const auth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY),
  });
  const { token } = (await auth({ type: 'app' })) as { token: string };
  const octokit = new Octokit({ auth: token, userAgent: 'laika-gateway' });
  const { data } = await octokit.apps.getRepoInstallation({ owner, repo });
  perEnv.set(key, data.id);
  return data.id;
};

/**
 * Build (or reuse) the laikacms repo bundle for a given tenant. The storage
 * repo's installation token is refreshed lazily inside `@laikacms/github`.
 */
export const reposForTenant = async (env: Env, tenant: Tenant): Promise<Repos> => {
  let perEnv = reposCache.get(env);
  if (!perEnv) {
    perEnv = new Map();
    reposCache.set(env, perEnv);
  }
  const k = tenantKey(tenant);
  const hit = perEnv.get(k);
  if (hit) return hit;

  const installationId = await resolveInstallationId(env, tenant.owner, tenant.repo);
  const storage = new GithubStorageRepository({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    installationId: String(installationId),
    owner: tenant.owner,
    repo: tenant.repo,
    branch: tenant.branch ?? 'main',
    serializerRegistry: {
      md: markdownSerializer,
      yaml: yamlSerializer,
      yml: yamlSerializer,
      json: jsonSerializer,
    },
    defaultFileExtension: 'md',
  });
  const settingsProvider = new DecapContentBaseSettingsProvider({
    storage,
    // By convention the SPA's Decap config lives at `public/config.yaml` in
    // each tenant's repo (matches what ess-cms ships). Override later if
    // tenants want it elsewhere.
    configKey: 'public/config',
  });
  const documents = new ContentBaseDocumentsRepository(storage, settingsProvider);
  const assets = new ContentBaseAssetsRepository(storage, settingsProvider);
  const bundle: Repos = { storage, documents, assets, settingsProvider };
  perEnv.set(k, bundle);
  return bundle;
};
